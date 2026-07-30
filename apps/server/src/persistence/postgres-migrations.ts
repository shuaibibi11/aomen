import type { SqlConnectionPool } from "./sql-executor.js";

export interface PostgresMigration {
  readonly version: string;
  readonly sql: string;
}

const MIGRATION_ADVISORY_LOCK_KEY = 916_450_102;

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: "001_training_auth_and_table_events",
    sql: `CREATE TABLE IF NOT EXISTS training_users (
  id TEXT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('trainee', 'operator')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS training_invitations (
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('trainee', 'operator')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_user_id TEXT REFERENCES training_users(id),
  PRIMARY KEY (code_hash)
);

CREATE INDEX IF NOT EXISTS training_invitations_active_expiry_index
  ON training_invitations (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES training_users(id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (token_hash)
);

CREATE INDEX IF NOT EXISTS auth_sessions_active_expiry_index
  ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_revoked_at_index
  ON auth_sessions (revoked_at);

CREATE TABLE IF NOT EXISTS training_tables (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES training_users(id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS table_events (
  table_id TEXT NOT NULL REFERENCES training_tables(id),
  seq BIGINT NOT NULL,
  event JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (table_id, seq)
);`,
  },
];

/**
 * Runs all outstanding migrations under a transaction-scoped advisory lock.
 * Re-running is safe because applied versions are recorded transactionally.
 */
export async function runPostgresMigrations(pool: SqlConnectionPool): Promise<void> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
    );
    const appliedMigrationRows = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const appliedVersions = new Set(appliedMigrationRows.rows.map((row) => row.version));

    for (const migration of POSTGRES_MIGRATIONS) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
    }

    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}
