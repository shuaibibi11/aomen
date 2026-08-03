import { createHash } from "node:crypto";
import { requireNonEmptyIdentifier, type PromptTemplateVersion } from "./domain.js";

export const MAX_PROMPT_TEMPLATE_BYTES = 64 * 1024;

const ALLOWED_TEMPLATE_TOKENS = new Set(["publicStateJson", "styleInstructions"]);
const TEMPLATE_TOKEN_PATTERN = /\{\{([^{}]*)\}\}/g;

export interface PromptTemplatePublicValues {
  readonly publicStateJson: string;
  readonly styleInstructions: string;
}

export function calculatePromptTemplateChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function validateTemplateTokens(content: string): void {
  let matchedToken: RegExpExecArray | null;
  while ((matchedToken = TEMPLATE_TOKEN_PATTERN.exec(content)) !== null) {
    const tokenName = matchedToken[1];
    if (tokenName === undefined || !ALLOWED_TEMPLATE_TOKENS.has(tokenName)) {
      throw new Error("prompt template contains an unsupported token");
    }
  }
  TEMPLATE_TOKEN_PATTERN.lastIndex = 0;
  const withoutCompleteTokens = content.replace(TEMPLATE_TOKEN_PATTERN, "");
  TEMPLATE_TOKEN_PATTERN.lastIndex = 0;
  if (withoutCompleteTokens.includes("{{") || withoutCompleteTokens.includes("}}")) {
    throw new Error("prompt template contains an unclosed token");
  }
}

/** A template is immutable after creation; activation changes its status only. */
export function validatePromptTemplateVersion(template: PromptTemplateVersion): PromptTemplateVersion {
  requireNonEmptyIdentifier(template.id, "template.id");
  if (template.key !== "player_bet") {
    throw new Error("template.key is invalid");
  }
  if (!Number.isSafeInteger(template.version) || template.version <= 0) {
    throw new Error("template.version must be a positive safe integer");
  }
  if (!["draft", "active", "archived"].includes(template.status)) {
    throw new Error("template.status is invalid");
  }
  const contentByteLength = Buffer.byteLength(template.content, "utf8");
  if (contentByteLength === 0 || contentByteLength > MAX_PROMPT_TEMPLATE_BYTES) {
    throw new Error("prompt template content exceeds the maximum size");
  }
  if (!/^[a-f0-9]{64}$/.test(template.checksum) || template.checksum !== calculatePromptTemplateChecksum(template.content)) {
    throw new Error("prompt template checksum is invalid");
  }
  validateTemplateTokens(template.content);
  return template;
}

/** Validates and detaches an immutable draft template before asynchronous persistence begins. */
export function normalizePromptTemplateVersion(
  template: PromptTemplateVersion,
): PromptTemplateVersion {
  validatePromptTemplateVersion(template);
  return Object.freeze({
    id: template.id,
    key: template.key,
    version: template.version,
    status: template.status,
    content: template.content,
    checksum: template.checksum,
  });
}

/** Renders only explicit public input; no identity, hidden state, or overrides are accepted. */
export function renderPromptTemplate(
  template: PromptTemplateVersion,
  publicValues: PromptTemplatePublicValues,
): string {
  validatePromptTemplateVersion(template);
  return template.content.replace(TEMPLATE_TOKEN_PATTERN, (_matchedToken, tokenName: string) => {
    if (tokenName === "publicStateJson") {
      return publicValues.publicStateJson;
    }
    if (tokenName === "styleInstructions") {
      return publicValues.styleInstructions;
    }
    throw new Error("prompt template contains an unsupported token");
  });
}
