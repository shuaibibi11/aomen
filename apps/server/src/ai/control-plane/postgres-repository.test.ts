import { describe, expect, it } from "vitest";
import { PostgresLlmControlPlaneRepository } from "./postgres-repository.js";
import {
  LlmRoutingRevisionConflictError,
  type EffectiveMutationRequest,
} from "./repository.js";
import type { SqlQueryResult, SqlTransactionClient } from "../../persistence/sql-executor.js";

const route = {
  id: "route-injection",
  scope: "player_bet" as const,
  priority: 1,
  providerId: "provider-1",
  endpointId: "endpoint-1",
  credentialId: "credential-1",
  modelId: "model-1",
  enabled: true,
  attemptTimeoutMs: 1000,
  maxResponseBodyBytes: 4096,
};

const mutationRequest: EffectiveMutationRequest = {
  expectedRevision: 4,
  audit: {
    actorUserId: "operator-1",
    action: "route.created",
    safeMetadata: { changedFields: ["priority"] },
  },
};

class FakeClient implements SqlTransactionClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  releases = 0;
  currentRevision: string | number = "4";
  throwUniqueViolation = false;
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<Row>> {
    this.queries.push({ text, values });
    if (this.throwUniqueViolation && text.startsWith("UPDATE llm_routing_revisions")) {
      throw Object.assign(new Error("unique violation"), { code: "23505" });
    }
    if (text.includes("SELECT revision") && text.includes("FOR UPDATE")) {
      return { rows: [{ revision: this.currentRevision } as Row], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
  release(): void { this.releases += 1; }
}

class FakePool {
  readonly client = new FakeClient();
  auditRows: Record<string, unknown>[] = [];
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<Row>> { return this.client.query(text, values); }
  async connect(): Promise<FakeClient> { return this.client; }
}

describe("PostgresLlmControlPlaneRepository", () => {
  it("locks the current scope revision, updates it, snapshots, and audits in one transaction", async () => {
    const pool = new FakePool();
    const repository = new PostgresLlmControlPlaneRepository(pool);
    await repository.applyEffectiveMutation({ kind: "route.set", route }, mutationRequest);

    expect(pool.client.queries.map((query) => query.text)).toContain("BEGIN");
    expect(pool.client.queries.map((query) => query.text)).toContain("COMMIT");
    expect(pool.client.queries.some((query) =>
      query.text.includes("SELECT revision") && query.text.includes("FOR UPDATE"),
    )).toBe(true);
    expect(pool.client.queries.some((query) => query.text.startsWith("UPDATE llm_routing_revisions"))).toBe(true);
    expect(pool.client.queries.some((query) => query.text.includes("llm_routing_snapshots"))).toBe(true);
    expect(pool.client.queries.some((query) => query.text.includes("llm_configuration_audit_log"))).toBe(true);
    expect(pool.client.queries.some((query) => query.text.includes("route-injection"))).toBe(false);
    expect(pool.client.queries.flatMap((query) => query.values)).toContain("route-injection");
  });

  it("rolls back and maps a locked revision mismatch to a typed conflict", async () => {
    const pool = new FakePool();
    pool.client.currentRevision = "5";
    const repository = new PostgresLlmControlPlaneRepository(pool);
    await expect(repository.applyEffectiveMutation(
      { kind: "route.set", route },
      mutationRequest,
    )).rejects.toBeInstanceOf(LlmRoutingRevisionConflictError);
    expect(pool.client.queries.map((query) => query.text)).toContain("ROLLBACK");
  });

  it("normalizes PostgreSQL unique violations to typed revision conflicts", async () => {
    const pool = new FakePool();
    pool.client.throwUniqueViolation = true;
    const repository = new PostgresLlmControlPlaneRepository(pool);

    await expect(repository.applyEffectiveMutation(
      { kind: "route.set", route },
      mutationRequest,
    )).rejects.toBeInstanceOf(LlmRoutingRevisionConflictError);
    expect(pool.client.queries.map((query) => query.text)).toContain("ROLLBACK");
  });

  it("rejects an unsafe expected revision with the same typed conflict", async () => {
    const pool = new FakePool();
    const repository = new PostgresLlmControlPlaneRepository(pool);

    await expect(repository.applyEffectiveMutation(
      { kind: "route.set", route },
      { ...mutationRequest, expectedRevision: -1 },
    )).rejects.toBeInstanceOf(LlmRoutingRevisionConflictError);
    expect(pool.client.queries).toEqual([]);
  });

  it("decodes audit BIGINT strings only when they are safe integers", async () => {
    const pool = new FakePool();
    pool.query = async () => ({
      rows: [{
        id: "audit-1",
        action: "route.created",
        target_id: "route-1",
        revision: "42",
        actor_user_id: "operator-1",
        metadata: { changedFields: ["priority"] },
      }],
      rowCount: 1,
    });
    const repository = new PostgresLlmControlPlaneRepository(pool);

    await expect(repository.listAudit()).resolves.toEqual([
      expect.objectContaining({ revision: 42 }),
    ]);

    pool.query = async () => ({
      rows: [{
        id: "audit-2",
        action: "route.created",
        target_id: "route-1",
        revision: "9007199254740992",
        actor_user_id: "operator-1",
        metadata: {},
      }],
      rowCount: 1,
    });
    await expect(repository.listAudit()).rejects.toThrow("revision must be a non-negative safe integer");
  });
});
