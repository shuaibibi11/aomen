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
  {
    version: "002_llm_control_plane",
    sql: `CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('openai_compatible', 'anthropic_messages', 'gemini_generate_content')),
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llm_endpoints (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES llm_providers(id),
  base_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, provider_id)
);

CREATE TABLE IF NOT EXISTS llm_credentials (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES llm_providers(id),
  endpoint_id TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  enabled BOOLEAN NOT NULL,
  nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL CHECK (octet_length(auth_tag) = 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (endpoint_id, provider_id) REFERENCES llm_endpoints(id, provider_id),
  UNIQUE (id, provider_id, endpoint_id)
);

CREATE TABLE IF NOT EXISTS llm_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES llm_providers(id),
  endpoint_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (endpoint_id, provider_id) REFERENCES llm_endpoints(id, provider_id),
  UNIQUE (id, provider_id, endpoint_id)
);

CREATE TABLE IF NOT EXISTS llm_routes (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope = 'player_bet'),
  priority INTEGER NOT NULL CHECK (priority > 0),
  provider_id TEXT NOT NULL REFERENCES llm_providers(id),
  endpoint_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  attempt_timeout_ms INTEGER NOT NULL CHECK (attempt_timeout_ms BETWEEN 1 AND 30000),
  max_response_body_bytes INTEGER NOT NULL CHECK (max_response_body_bytes BETWEEN 1024 AND 1048576),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (endpoint_id, provider_id) REFERENCES llm_endpoints(id, provider_id),
  FOREIGN KEY (credential_id, provider_id, endpoint_id) REFERENCES llm_credentials(id, provider_id, endpoint_id),
  FOREIGN KEY (model_id, provider_id, endpoint_id) REFERENCES llm_models(id, provider_id, endpoint_id),
  UNIQUE (scope, priority)
);

CREATE INDEX IF NOT EXISTS llm_routes_enabled_priority_index
  ON llm_routes (scope, priority)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS llm_prompt_template_versions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL CHECK (key = 'player_bet'),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  content TEXT NOT NULL CHECK (octet_length(content) <= 65536),
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS llm_prompt_template_one_active_key_index
  ON llm_prompt_template_versions (key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS llm_routing_revisions (
  scope TEXT NOT NULL CHECK (scope = 'player_bet'),
  revision BIGINT NOT NULL CHECK (revision >= 0),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, revision)
);

CREATE TABLE IF NOT EXISTS llm_configuration_audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision >= 0),
  actor_user_id TEXT NOT NULL REFERENCES training_users(id),
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS llm_configuration_audit_log_target_created_index
  ON llm_configuration_audit_log (target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_configuration_audit_log_actor_created_index
  ON llm_configuration_audit_log (actor_user_id, created_at DESC);`,
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
