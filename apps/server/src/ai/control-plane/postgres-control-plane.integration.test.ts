import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runPostgresMigrations } from "../../persistence/postgres-migrations.js";
import type {
  SqlConnectionPool,
  SqlQueryResult,
  SqlTransactionClient,
} from "../../persistence/sql-executor.js";
import { PostgresLlmControlPlaneRepository } from "./postgres-repository.js";
import { LlmControlPlaneService } from "./service.js";
import { LlmRoutingRevisionConflictError } from "./repository.js";

function readPostgresIntegrationUrl(): string | undefined {
  const configuredUrl = process.env.POSTGRES_INTEGRATION_URL;
  if (configuredUrl === undefined || configuredUrl.length === 0) {
    return undefined;
  }
  try {
    const parsedUrl = new URL(configuredUrl);
    return parsedUrl.protocol === "postgres:" || parsedUrl.protocol === "postgresql:"
      ? configuredUrl
      : undefined;
  } catch {
    return undefined;
  }
}

function quoteTrustedIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error("schema identifier is invalid");
  }
  return `"${identifier}"`;
}

function createSchemaScopedPool(pool: Pool, schemaName: string): SqlConnectionPool {
  const quotedSchemaName = quoteTrustedIdentifier(schemaName);
  const configureClientSchema = async (client: PoolClient): Promise<void> => {
    await client.query(`SET search_path TO ${quotedSchemaName}, public`);
  };
  const adaptResult = <Row extends Record<string, unknown>>(result: {
    readonly rows: readonly Row[];
    readonly rowCount: number | null;
  }): SqlQueryResult<Row> => ({ rows: result.rows, rowCount: result.rowCount });

  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      const client = await pool.connect();
      try {
        await configureClientSchema(client);
        return adaptResult(await client.query<Row>(text, values));
      } finally {
        client.release();
      }
    },
    async connect(): Promise<SqlTransactionClient> {
      const client = await pool.connect();
      await configureClientSchema(client);
      return {
        async query<Row extends Record<string, unknown> = Record<string, unknown>>(
          text: string,
          values: readonly unknown[] = [],
        ): Promise<SqlQueryResult<Row>> {
          return adaptResult(await client.query<Row>(text, values));
        },
        release(): void {
          client.release();
        },
      };
    },
  };
}

const postgresIntegrationUrl = readPostgresIntegrationUrl();
const describePostgresIntegration = postgresIntegrationUrl === undefined ? describe.skip : describe;

describePostgresIntegration("PostgreSQL control-plane integration", () => {
  const schemaName = `llm_control_plane_it_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const quotedSchemaName = quoteTrustedIdentifier(schemaName);
  let pool: Pool;
  let service: LlmControlPlaneService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: postgresIntegrationUrl });
    await pool.query(`CREATE SCHEMA ${quotedSchemaName}`);
    const schemaScopedPool = createSchemaScopedPool(pool, schemaName);
    await runPostgresMigrations(schemaScopedPool, { migrationSchema: schemaName });
    await schemaScopedPool.query(
      `INSERT INTO training_users (id, email, role, password_hash, created_at)
VALUES ($1, $2, 'operator', $3, NOW())`,
      ["operator-1", "operator-1@example.test", "not-a-real-password-hash"],
    );
    service = new LlmControlPlaneService(new PostgresLlmControlPlaneRepository(schemaScopedPool));
  });

  afterAll(async () => {
    if (pool === undefined) {
      return;
    }
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  it("provides revision-zero snapshot, a single concurrent winner, and safe audit revision decoding", async () => {
    await expect(service.readRoutingSnapshot("player_bet")).resolves.toEqual({
      revision: 0,
      scope: "player_bet",
      activeTemplate: null,
      routes: [],
    });

    await service.createProvider({
      id: "provider-1",
      name: "Integration provider",
      kind: "openai_compatible",
      enabled: true,
    });
    await service.createEndpoint({
      id: "endpoint-1",
      providerId: "provider-1",
      baseUrl: "https://api.openai.com/v1",
      enabled: true,
    });
    await service.createCredential({
      id: "credential-1",
      providerId: "provider-1",
      endpointId: "endpoint-1",
      keyVersion: 1,
      enabled: true,
    }, {
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.from("integration-ciphertext"),
      authTag: Buffer.alloc(16),
    });
    await service.createModel({
      id: "model-1",
      providerId: "provider-1",
      endpointId: "endpoint-1",
      name: "integration-model",
      enabled: true,
    });

    const concurrentResults = await Promise.allSettled([
      service.setRoute({
        id: "route-1",
        scope: "player_bet",
        priority: 1,
        providerId: "provider-1",
        endpointId: "endpoint-1",
        credentialId: "credential-1",
        modelId: "model-1",
        enabled: true,
        attemptTimeoutMs: 1000,
        maxResponseBodyBytes: 4096,
      }, {
        expectedRevision: 0,
        audit: {
          actorUserId: "operator-1",
          action: "route.created",
          safeMetadata: { changedFields: ["priority"] },
        },
      }),
      service.setRoute({
        id: "route-2",
        scope: "player_bet",
        priority: 2,
        providerId: "provider-1",
        endpointId: "endpoint-1",
        credentialId: "credential-1",
        modelId: "model-1",
        enabled: true,
        attemptTimeoutMs: 1000,
        maxResponseBodyBytes: 4096,
      }, {
        expectedRevision: 0,
        audit: {
          actorUserId: "operator-1",
          action: "route.created",
          safeMetadata: { changedFields: ["priority"] },
        },
      }),
    ]);

    expect(concurrentResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejectedResult = concurrentResults.find((result) => result.status === "rejected");
    expect(rejectedResult?.status).toBe("rejected");
    if (rejectedResult?.status === "rejected") {
      expect(rejectedResult.reason).toBeInstanceOf(LlmRoutingRevisionConflictError);
    }

    const auditRecords = await service.listAudit();
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0]).toEqual(expect.objectContaining({ revision: 1 }));
    expect(typeof auditRecords[0]?.revision).toBe("number");
  });
});
