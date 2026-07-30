import { describe, expect, it } from "vitest";
import {
  createPostgresConnectionOptions,
  DEFAULT_POSTGRES_POOL_OPTIONS,
} from "./postgres-connection.js";

describe("PostgreSQL connection configuration", () => {
  it("builds bounded, injectable pool options from validated server configuration", () => {
    expect(
      createPostgresConnectionOptions(
        { mode: "postgres", databaseUrl: "postgresql://user:password@db.example.test/training" },
        { max: 12, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 3_000 },
      ),
    ).toEqual({
      connectionString: "postgresql://user:password@db.example.test/training",
      max: 12,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 3_000,
    });
  });

  it("uses conservative defaults without attempting a database connection", () => {
    expect(
      createPostgresConnectionOptions({
        mode: "postgres",
        databaseUrl: "postgres://user:password@db.example.test/training",
      }),
    ).toEqual({
      connectionString: "postgres://user:password@db.example.test/training",
      ...DEFAULT_POSTGRES_POOL_OPTIONS,
    });
  });
});
