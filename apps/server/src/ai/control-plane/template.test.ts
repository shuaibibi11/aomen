import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calculatePromptTemplateChecksum, renderPromptTemplate, validatePromptTemplateVersion } from "./template.js";

function createTemplate(content: string) {
  return { id: "template-1", key: "player_bet" as const, version: 1, status: "draft" as const, content, checksum: calculatePromptTemplateChecksum(content) };
}

describe("prompt template domain", () => {
  it("validates checksum and renders only public values", () => {
    const template = createTemplate("state={{publicStateJson}} style={{styleInstructions}}");
    expect(validatePromptTemplateVersion(template)).toEqual(template);
    expect(renderPromptTemplate(template, { publicStateJson: "{\"phase\":\"betting\"}", styleInstructions: "concise" })).toBe("state={\"phase\":\"betting\"} style=concise");
    expect(calculatePromptTemplateChecksum(template.content)).toBe(createHash("sha256").update(template.content).digest("hex"));
  });

  it.each(["unknown={{secret}}", "unclosed={{publicStateJson", "closed={{publicStateJson}} trailing {{"])("rejects unknown or malformed template token %s", (content) => {
    expect(() => validatePromptTemplateVersion(createTemplate(content))).toThrow();
  });

  it("rejects tampered checksums and identity or hidden claim injection", () => {
    expect(() => validatePromptTemplateVersion({ ...createTemplate("{{publicStateJson}}"), checksum: "0".repeat(64) })).toThrow();
    expect(() => renderPromptTemplate(createTemplate("{{identity}}"), { publicStateJson: "{}", styleInstructions: "safe" })).toThrow();
  });

  it("rejects an empty immutable template version", () => {
    expect(() => validatePromptTemplateVersion(createTemplate(""))).toThrow();
  });
});
