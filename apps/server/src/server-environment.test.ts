import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadRepositoryEnvironment,
  resolveRepositoryEnvironmentPath,
} from "./server-environment.js";

const REPOSITORY_ROOT = resolve("test-repository");

function createModuleUrl(relativeModulePath: string): string {
  return pathToFileURL(join(REPOSITORY_ROOT, relativeModulePath)).href;
}

describe("server environment", () => {
  it.each([
    ["TypeScript source module", "apps/server/src/server-environment.ts"],
    ["compiled JavaScript module", "apps/server/dist/server-environment.js"],
  ])("resolves the root .env from a %s URL", (_moduleKind, modulePath) => {
    expect(resolveRepositoryEnvironmentPath(createModuleUrl(modulePath))).toBe(
      join(REPOSITORY_ROOT, ".env"),
    );
  });

  it("passes the root .env and preserving override option to its loader", () => {
    const loaderCalls: Array<{ path: string; override: false }> = [];

    loadRepositoryEnvironment(
      createModuleUrl("apps/server/src/server-environment.ts"),
      (options) => {
        loaderCalls.push(options);
      },
    );

    expect(loaderCalls).toEqual([
      { path: join(REPOSITORY_ROOT, ".env"), override: false },
    ]);
  });
});
