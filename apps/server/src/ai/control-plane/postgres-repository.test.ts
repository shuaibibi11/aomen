import { describe, expect, it } from "vitest";
import { PostgresLlmControlPlaneRepository } from "./postgres-repository.js";
import type { SqlQueryResult, SqlTransactionClient } from "../../persistence/sql-executor.js";

class FakeClient implements SqlTransactionClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  releases = 0;
  nextRowCount = 1;
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<Row>> {
    this.queries.push({ text, values });
    return { rows: [], rowCount: this.nextRowCount };
  }
  release(): void { this.releases += 1; }
}

class FakePool {
  readonly client = new FakeClient();
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<Row>> { return this.client.query(text, values); }
  async connect(): Promise<FakeClient> { return this.client; }
}

describe("PostgresLlmControlPlaneRepository", () => {
  it("uses parameterized SQL and transaction boundaries for route revision updates", async () => {
    const pool = new FakePool();
    const repository = new PostgresLlmControlPlaneRepository(pool);
    await repository.setRoute({ id: "route-injection", scope: "player_bet", priority: 1, providerId: "p", endpointId: "e", credentialId: "c", modelId: "m", enabled: true, attemptTimeoutMs: 1000, maxResponseBodyBytes: 4096 }, 4);
    expect(pool.client.queries.map((query) => query.text)).toContain("BEGIN");
    expect(pool.client.queries.map((query) => query.text)).toContain("COMMIT");
    expect(pool.client.queries.some((query) => query.text.includes("route-injection"))).toBe(false);
    expect(pool.client.queries.flatMap((query) => query.values)).toContain("route-injection");
  });

  it("rolls back on optimistic revision conflict", async () => {
    const pool = new FakePool();
    pool.client.nextRowCount = 0;
    const repository = new PostgresLlmControlPlaneRepository(pool);
    await expect(repository.setRoute({ id: "r", scope: "player_bet", priority: 1, providerId: "p", endpointId: "e", credentialId: "c", modelId: "m", enabled: true, attemptTimeoutMs: 1000, maxResponseBodyBytes: 4096 }, 4)).rejects.toThrow();
    expect(pool.client.queries.map((query) => query.text)).toContain("ROLLBACK");
  });
});
