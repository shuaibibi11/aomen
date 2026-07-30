import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";

export interface RepositoryEnvironmentLoader {
  (options: { path: string; override: false }): unknown;
}

/**
 * Resolves the workspace-level environment file from either the TypeScript
 * source location or its compiled server distribution location.
 */
export function resolveRepositoryEnvironmentPath(moduleUrl: string): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  return resolve(moduleDirectory, "../../..", ".env");
}

/** Loads local development settings without replacing explicitly provided values. */
export function loadRepositoryEnvironment(
  moduleUrl: string,
  loadEnvironmentFile: RepositoryEnvironmentLoader = loadDotenvFile,
): void {
  loadEnvironmentFile({
    path: resolveRepositoryEnvironmentPath(moduleUrl),
    override: false,
  });
}
