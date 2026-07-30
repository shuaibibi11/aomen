import { describe, expect, it } from "vitest";
import { resolvePersistenceRuntimeConfig } from "./persistence-runtime-config.js";

const TEST_DATABASE_URL = "postgresql://training_user:example-password@db.example.test:5432/training";

describe("resolvePersistenceRuntimeConfig", () => {
  it("defaults to memory persistence without a database URL", () => {
    expect(resolvePersistenceRuntimeConfig({})).toEqual({ mode: "memory" });
  });

  it("defaults remote PostgreSQL connections to verify-full TLS", () => {
    expect(
      resolvePersistenceRuntimeConfig({
        PERSISTENCE_MODE: "postgres",
        DATABASE_URL: TEST_DATABASE_URL,
      }),
    ).toEqual({ mode: "postgres", databaseUrl: TEST_DATABASE_URL, tlsMode: "verify-full" });
  });

  it("allows disable mode only for explicit local development endpoints", () => {
    expect(
      resolvePersistenceRuntimeConfig({
        PERSISTENCE_MODE: "postgres",
        DATABASE_URL: "postgresql://training_user:example-password@127.0.0.1:5432/training",
        DATABASE_TLS_MODE: "disable",
      }),
    ).toEqual({
      mode: "postgres",
      databaseUrl: "postgresql://training_user:example-password@127.0.0.1:5432/training",
      tlsMode: "disable",
    });
    expect(
      resolvePersistenceRuntimeConfig({
        PERSISTENCE_MODE: "postgres",
        DATABASE_URL: "postgresql:///training?host=%2Fvar%2Frun%2Fpostgresql",
        DATABASE_TLS_MODE: "disable",
      }),
    ).toEqual({
      mode: "postgres",
      databaseUrl: "postgresql:///training?host=%2Fvar%2Frun%2Fpostgresql",
      tlsMode: "disable",
    });
  });

  it.each([
    { DATABASE_TLS_MODE: "disable" },
    { DATABASE_TLS_MODE: "verify-ca" },
  ])("rejects insecure TLS modes for remote PostgreSQL %#", (tlsEnvironment) => {
    const error = (() => {
      try {
        resolvePersistenceRuntimeConfig({
          PERSISTENCE_MODE: "postgres",
          DATABASE_URL: TEST_DATABASE_URL,
          ...tlsEnvironment,
        });
      } catch (caughtError) {
        return caughtError;
      }
      throw new Error("Expected persistence configuration to reject");
    })();

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(TEST_DATABASE_URL);
    expect(String(error)).not.toContain("training_user");
    expect(String(error)).not.toContain("example-password");
  });

  it.each([
    "?sslmode=disable",
    "?ssl=true",
    "?sslrootcert=%2Ftmp%2Fcertificate.pem",
  ])("rejects TLS query injection %#", (queryString) => {
    const error = (() => {
      try {
        resolvePersistenceRuntimeConfig({
          PERSISTENCE_MODE: "postgres",
          DATABASE_URL: `${TEST_DATABASE_URL}${queryString}`,
        });
      } catch (caughtError) {
        return caughtError;
      }
      throw new Error("Expected persistence configuration to reject");
    })();

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(TEST_DATABASE_URL);
    expect(String(error)).not.toContain("training_user");
    expect(String(error)).not.toContain("example-password");
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
