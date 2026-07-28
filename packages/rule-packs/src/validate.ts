/**
 * Rule-pack validation.
 *
 * `validateRulePack` is the one place raw data becomes a trusted `RulePack`.
 * It runs the Zod schema (which already enforces max >= min via a refinement)
 * and returns a typed pack, throwing a readable error otherwise.
 */
import { rulePackSchema, type RulePack } from "./schema.js";

/** Error thrown when a rule pack fails validation. */
export class RulePackValidationError extends Error {
  constructor(
    message: string,
    /** The Zod issues, for callers that want to surface field-level detail. */
    readonly issues: readonly unknown[],
  ) {
    super(message);
    this.name = "RulePackValidationError";
  }
}

/**
 * Validate arbitrary data as a rule pack.
 *
 * Throws `RulePackValidationError` with the collected issues if the data does
 * not match the schema, so a bad pack fails loudly at load time rather than
 * silently mid-game.
 */
export function validateRulePack(data: unknown): RulePack {
  const result = rulePackSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues;
    const summary = issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new RulePackValidationError(
      `Invalid rule pack: ${summary}`,
      issues,
    );
  }
  return result.data;
}
