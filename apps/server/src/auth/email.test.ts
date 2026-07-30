import { describe, expect, it } from "vitest";

describe("training email validation", () => {
  it("canonicalizes accepted email addresses and rejects malformed values", async () => {
    const emailModulePath = "./email.js";
    const emailDomain = await import(emailModulePath);

    expect(emailDomain.canonicalizeTrainingEmail("  TRAINEE@Example.TEST ")).toBe(
      "trainee@example.test",
    );
    expect(emailDomain.isValidTrainingEmail("trainee@example.test")).toBe(true);
    expect(emailDomain.isValidTrainingEmail("   ")).toBe(false);
    expect(emailDomain.isValidTrainingEmail("missing-at-sign.example.test")).toBe(false);
    expect(emailDomain.isValidTrainingEmail(`trainee@${"a".repeat(250)}.test`)).toBe(false);
  });
});
