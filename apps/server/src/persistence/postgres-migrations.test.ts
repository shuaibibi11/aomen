import { describe, expect, it } from "vitest";
import {
  POSTGRES_MIGRATIONS,
  runPostgresMigrations,
} from "./postgres-migrations.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeMigrationClient {
  readonly appliedVersions = new Set<string>();
  readonly queries: RecordedQuery[] = [];
  released = false;
  failMigration = false;

  async query(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    if (text === "SELECT version FROM schema_migrations") {
      return { rows: [...this.appliedVersions].map((version) => ({ version })) };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      this.appliedVersions.add(String(values[0]));
    }
    if (this.failMigration && text.includes("CREATE TABLE IF NOT EXISTS training_users")) {
      throw new Error("simulated migration failure");
    }
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class FakeMigrationPool {
  readonly client = new FakeMigrationClient();

  async connect(): Promise<FakeMigrationClient> {
    return this.client;
  }
}

describe("PostgreSQL migrations", () => {
  it("uses an advisory lock and records each migration only once", async () => {
    const pool = new FakeMigrationPool();

    await runPostgresMigrations(pool);
    await runPostgresMigrations(pool);

    expect(pool.client.appliedVersions).toEqual(
      new Set(POSTGRES_MIGRATIONS.map((migration) => migration.version)),
    );
    const advisoryLockQueries = pool.client.queries.filter((query) =>
      query.text.startsWith("SELECT pg_advisory_xact_lock"),
    );
    expect(advisoryLockQueries).toHaveLength(2);
    expect(advisoryLockQueries.every((query) => query.text.includes("$1"))).toBe(true);
    expect(advisoryLockQueries.flatMap((query) => query.values)).toHaveLength(2);
    expect(
      pool.client.queries.filter((query) => query.text.startsWith("INSERT INTO schema_migrations")),
    ).toHaveLength(POSTGRES_MIGRATIONS.length);
    expect(pool.client.queries.filter((query) => query.text === "COMMIT")).toHaveLength(2);
    expect(pool.client.released).toBe(true);
  });

  it("rolls back and releases the connection when migration SQL fails", async () => {
    const pool = new FakeMigrationPool();
    pool.client.failMigration = true;

    await expect(runPostgresMigrations(pool)).rejects.toThrow("simulated migration failure");

    expect(pool.client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(pool.client.released).toBe(true);
  });

  it("defines the authentication and table-event persistence constraints", () => {
    const migrationSql = POSTGRES_MIGRATIONS.map((migration) => migration.sql).join("\n");

    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS training_users");
    expect(migrationSql).toContain("email VARCHAR(254) NOT NULL UNIQUE");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS training_invitations");
    expect(migrationSql).toContain("code_hash TEXT NOT NULL UNIQUE");
    expect(migrationSql).toContain("used_by_user_id TEXT REFERENCES training_users(id)");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS auth_sessions");
    expect(migrationSql).toContain("token_hash TEXT NOT NULL UNIQUE");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS training_tables");
    expect(migrationSql).toContain("user_id TEXT NOT NULL UNIQUE");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS table_events");
    expect(migrationSql).toContain("PRIMARY KEY (table_id, seq)");
    expect(migrationSql).toContain("event JSONB NOT NULL");
  });

  it("adds immutable secret-free LLM control-plane persistence constraints", () => {
    const controlPlaneMigration = POSTGRES_MIGRATIONS.find(
      (migration) => migration.version === "002_llm_control_plane",
    );

    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_providers");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_endpoints");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_credentials");
    expect(controlPlaneMigration?.sql).toContain("ciphertext BYTEA NOT NULL");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_models");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_routes");
    expect(controlPlaneMigration?.sql).toContain("UNIQUE (scope, priority)");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_prompt_template_versions");
    expect(controlPlaneMigration?.sql).toContain("WHERE status = 'active'");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_routing_revisions");
    expect(controlPlaneMigration?.sql).toContain("scope TEXT PRIMARY KEY CHECK (scope = 'player_bet')");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_routing_snapshots");
    expect(controlPlaneMigration?.sql).toContain("INSERT INTO llm_routing_revisions (scope, revision)");
    expect(controlPlaneMigration?.sql).toContain("INSERT INTO llm_routing_snapshots (scope, revision, snapshot)");
    expect(controlPlaneMigration?.sql).toContain("ON CONFLICT (scope) DO NOTHING");
    expect(controlPlaneMigration?.sql).toContain("ON CONFLICT (scope, revision) DO NOTHING");
    expect(controlPlaneMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS llm_configuration_audit_log");
    expect(controlPlaneMigration?.sql).toContain("metadata JSONB NOT NULL CHECK");
  });

  it("uses a validated quoted schema search path when requested", async () => {
    const pool = new FakeMigrationPool();

    await runPostgresMigrations(pool, { migrationSchema: "control_plane_test" });

    expect(pool.client.queries).toContainEqual({
      text: 'SET LOCAL search_path TO "control_plane_test", public',
      values: [],
    });
    await expect(runPostgresMigrations(pool, { migrationSchema: "unsafe-name" })).rejects.toThrow(
      "migration schema identifier is invalid",
    );
  });
});
