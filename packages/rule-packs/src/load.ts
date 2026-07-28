/**
 * Rule-pack loading.
 *
 * Packs live as JSON under packs/. The loader reads one by id relative to the
 * packs directory, parses it, and validates it before returning, so callers
 * always receive a trusted `RulePack`.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRulePack } from "./validate.js";
import type { RulePack } from "./schema.js";

/**
 * Absolute filesystem path to the packs directory, resolved from this module.
 *
 * `fileURLToPath` yields a plain OS path (including the drive letter on
 * Windows), so paths are joined with node:path rather than the URL
 * constructor, which would reject a Windows path as an invalid base.
 */
const PACKS_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packs",
);

/**
 * Load and validate a rule pack from a relative path under packs/.
 *
 * Example: `loadRulePack("dev/generic-macau-baccarat.v1.json")`.
 */
export async function loadRulePack(relativePath: string): Promise<RulePack> {
  const absolutePath = join(PACKS_DIRECTORY, relativePath);
  const raw = await readFile(absolutePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return validateRulePack(parsed);
}

export { PACKS_DIRECTORY };
