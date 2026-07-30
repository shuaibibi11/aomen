import { describe, expect, it, vi } from "vitest";
import {
  createPostgresPool,
  createPostgresConnectionOptions,
  DEFAULT_POSTGRES_POOL_OPTIONS,
} from "./postgres-connection.js";
import type { PostgresPersistenceRuntimeConfig } from "./persistence-runtime-config.js";

const REMOTE_RUNTIME_CONFIG = {
  mode: "postgres",
  databaseUrl: "postgresql://user:password@db.example.test/training",
  tlsMode: "verify-full",
} as unknown as PostgresPersistenceRuntimeConfig;

class FakePostgresPool {
  private readonly idleErrorHandlers: Array<(error: Error) => void> = [];
  endCallCount = 0;

  on(eventName: "error", handler: (error: Error) => void): this {
    if (eventName === "error") {
      this.idleErrorHandlers.push(handler);
    }
    return this;
  }

  dispatchIdleClientError(error: Error): void {
    for (const handler of this.idleErrorHandlers) {
      handler(error);
    }
  }

  async end(): Promise<void> {
    this.endCallCount += 1;
  }
}

type ManagedPoolFactory = (
  runtimeConfig: PostgresPersistenceRuntimeConfig,
  overrides: Record<string, never>,
  dependencies: Readonly<{
    poolFactory: (configuration: Record<string, unknown>) => FakePostgresPool;
    onIdleClientError?: (error: Error) => void;
  }>,
) => Readonly<{ close(): Promise<void> }>;

const createManagedPool = createPostgresPool as unknown as ManagedPoolFactory;

describe("PostgreSQL connection configuration", () => {
  it("builds bounded, injectable pool options from validated server configuration", () => {
    expect(
      createPostgresConnectionOptions(
        REMOTE_RUNTIME_CONFIG,
        { max: 12, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 3_000 },
      ),
    ).toEqual({
      connectionString: "postgresql://user:password@db.example.test/training",
      ssl: { rejectUnauthorized: true },
      max: 12,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 3_000,
    });
  });

  it("uses conservative defaults without attempting a database connection", () => {
    expect(
      createPostgresConnectionOptions(REMOTE_RUNTIME_CONFIG),
    ).toEqual({
      connectionString: "postgresql://user:password@db.example.test/training",
      ssl: { rejectUnauthorized: true },
      ...DEFAULT_POSTGRES_POOL_OPTIONS,
    });
  });

  it("contains idle client failures and closes the pool without connecting", async () => {
    const fakePool = new FakePostgresPool();
    const reportedErrors: Error[] = [];
    let receivedPoolConfiguration: Record<string, unknown> | undefined;
    const sensitiveIdleError = new Error(
      "connection failed for postgresql://user:password@db.example.test/training",
    );

    const managedPool = createManagedPool(REMOTE_RUNTIME_CONFIG, {}, {
      poolFactory: (configuration) => {
        receivedPoolConfiguration = configuration;
        return fakePool;
      },
      onIdleClientError: (error) => {
        reportedErrors.push(error);
      },
    });

    expect(receivedPoolConfiguration).toMatchObject({ ssl: { rejectUnauthorized: true } });
    expect(() => fakePool.dispatchIdleClientError(sensitiveIdleError)).not.toThrow();
    expect(reportedErrors).toEqual([sensitiveIdleError]);

    await managedPool.close();
    expect(fakePool.endCallCount).toBe(1);
  });

  it("reports only a safe generic message by default for idle client failures", () => {
    const fakePool = new FakePostgresPool();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveIdleError = new Error(
      "connection failed for postgresql://user:password@db.example.test/training",
    );

    try {
      createManagedPool(REMOTE_RUNTIME_CONFIG, {}, {
        poolFactory: () => fakePool,
      });

      expect(() => fakePool.dispatchIdleClientError(sensitiveIdleError)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith("PostgreSQL pool idle client error");
      expect(consoleErrorSpy.mock.calls.flat().join(" ")).not.toContain(sensitiveIdleError.message);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
