import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { PostgresPersistenceRuntimeConfig } from "./persistence-runtime-config.js";
import type {
  SqlConnectionPool,
  SqlQueryResult,
  SqlTransactionClient,
} from "./sql-executor.js";

export interface PostgresPoolOptions {
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
}

export interface PostgresConnectionOptions extends PostgresPoolOptions {
  readonly connectionString: string;
  readonly ssl: false | Readonly<{ rejectUnauthorized: true }>;
}

export interface PostgresPoolDependencies {
  readonly poolFactory?: (configuration: PoolConfig) => Pool;
  readonly onIdleClientError?: (error: Error) => void;
}

export interface ManagedPostgresPool {
  readonly pool: Pool;
  close(): Promise<void>;
}

export const DEFAULT_POSTGRES_POOL_OPTIONS: PostgresPoolOptions = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
};

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
  optionName: string,
): number {
  const resolvedValue = value ?? fallback;
  if (!Number.isSafeInteger(resolvedValue) || resolvedValue <= 0) {
    throw new Error(`${optionName} must be a positive safe integer`);
  }
  return resolvedValue;
}

/**
 * Creates bounded pool settings from a configuration already validated by
 * resolvePersistenceRuntimeConfig. It never logs the connection string.
 */
export function createPostgresConnectionOptions(
  runtimeConfig: PostgresPersistenceRuntimeConfig,
  overrides: Partial<PostgresPoolOptions> = {},
): PostgresConnectionOptions {
  return {
    connectionString: runtimeConfig.databaseUrl,
    ssl: runtimeConfig.tlsMode === "verify-full" ? { rejectUnauthorized: true } : false,
    max: resolvePositiveInteger(overrides.max, DEFAULT_POSTGRES_POOL_OPTIONS.max, "max"),
    connectionTimeoutMillis: resolvePositiveInteger(
      overrides.connectionTimeoutMillis,
      DEFAULT_POSTGRES_POOL_OPTIONS.connectionTimeoutMillis,
      "connectionTimeoutMillis",
    ),
    idleTimeoutMillis: resolvePositiveInteger(
      overrides.idleTimeoutMillis,
      DEFAULT_POSTGRES_POOL_OPTIONS.idleTimeoutMillis,
      "idleTimeoutMillis",
    ),
  };
}

function reportIdleClientError(
  error: Error,
  onIdleClientError: ((error: Error) => void) | undefined,
): void {
  if (onIdleClientError !== undefined) {
    try {
      onIdleClientError(error);
      return;
    } catch {
      // Error listeners must not throw and crash the process.
    }
  }

  console.error("PostgreSQL pool idle client error");
}

/** Creates a real pg Pool only when a caller explicitly opts into postgres mode. */
export function createPostgresPool(
  runtimeConfig: PostgresPersistenceRuntimeConfig,
  overrides: Partial<PostgresPoolOptions> = {},
  dependencies: PostgresPoolDependencies = {},
): ManagedPostgresPool {
  const connectionOptions = createPostgresConnectionOptions(runtimeConfig, overrides);
  const poolConfig: PoolConfig = {
    connectionString: connectionOptions.connectionString,
    ssl: connectionOptions.ssl,
    max: connectionOptions.max,
    connectionTimeoutMillis: connectionOptions.connectionTimeoutMillis,
    idleTimeoutMillis: connectionOptions.idleTimeoutMillis,
  };
  const pool = dependencies.poolFactory?.(poolConfig) ?? new Pool(poolConfig);
  pool.on("error", (error) => {
    reportIdleClientError(error, dependencies.onIdleClientError);
  });

  return {
    pool,
    close: async () => pool.end(),
  };
}

class PgSqlTransactionClient implements SqlTransactionClient {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.client.query<Row>(text, [...values]);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  release(): void {
    this.client.release();
  }
}

/** Adapter that keeps pg-specific types out of repository logic and tests. */
export class PgSqlConnectionPool implements SqlConnectionPool {
  constructor(private readonly pool: Pool) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.pool.query<Row>(text, [...values]);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  async connect(): Promise<SqlTransactionClient> {
    return new PgSqlTransactionClient(await this.pool.connect());
  }
}
