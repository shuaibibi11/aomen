import { describe, expect, it } from "vitest";
import { resolveServerStartupConfiguration } from "./server-startup-configuration.js";

const TEST_DATABASE_URL = "postgresql://training_user:example-password@db.example.test:5432/training";

describe("resolveServerStartupConfiguration", () => {
  it("defaults to memory persistence for an empty injected environment", () => {
    expect(resolveServerStartupConfiguration({})).toEqual({ mode: "memory" });
  });

  it("rejects postgres mode without a database URL", () => {
    expect(() =>
      resolveServerStartupConfiguration({ PERSISTENCE_MODE: "postgres" }),
    ).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");
  });

  it("accepts a valid postgres configuration", () => {
    expect(
      resolveServerStartupConfiguration({
        PERSISTENCE_MODE: "postgres",
        DATABASE_URL: TEST_DATABASE_URL,
      }),
    ).toEqual({ mode: "postgres", databaseUrl: TEST_DATABASE_URL });
  });
});
