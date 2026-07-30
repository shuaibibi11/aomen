import { describe, expect, it } from "vitest";
import { resolvePersistenceRuntimeConfig } from "./persistence-runtime-config.js";

const TEST_DATABASE_URL = "postgresql://training_user:example-password@db.example.test:5432/training";

describe("resolvePersistenceRuntimeConfig", () => {
  it("defaults to memory persistence without a database URL", () => {
    expect(resolvePersistenceRuntimeConfig({})).toEqual({ mode: "memory" });
  });

  it("accepts only explicit postgres mode with a postgres URL", () => {
    expect(
      resolvePersistenceRuntimeConfig({
        PERSISTENCE_MODE: "postgres",
        DATABASE_URL: TEST_DATABASE_URL,
      }),
    ).toEqual({ mode: "postgres", databaseUrl: TEST_DATABASE_URL });
  });

  it.each([
    { PERSISTENCE_MODE: "postgres" },
    { PERSISTENCE_MODE: "postgres", DATABASE_URL: "   " },
    { PERSISTENCE_MODE: "postgres", DATABASE_URL: "mysql://db.example.test/training" },
    { PERSISTENCE_MODE: "postgres", DATABASE_URL: "https://db.example.test/training" },
    { PERSISTENCE_MODE: "memory ", DATABASE_URL: TEST_DATABASE_URL },
    { PERSISTENCE_MODE: "sqlite", DATABASE_URL: TEST_DATABASE_URL },
  ])("rejects unsafe or invalid persistence values %#", (environment) => {
    const error = (() => {
      try {
        resolvePersistenceRuntimeConfig(environment);
      } catch (caughtError) {
        return caughtError;
      }
      throw new Error("Expected persistence configuration to reject");
    })();

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(TEST_DATABASE_URL);
  });
});
