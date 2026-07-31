import {
  requireNonEmptyIdentifier,
  validateAuditRecord,
  validateCredential,
  validateEndpoint,
  validateModel,
  validateProvider,
  validateRoute,
  type AuditRecord,
  type Credential,
  type Endpoint,
  type LlmRouteScope,
  type Model,
  type PromptTemplateVersion,
  type Provider,
  type Route,
  type RoutingSnapshot,
} from "./domain.js";
import {
  LlmRoutingRevisionConflictError,
  type CredentialCiphertext,
  type LlmControlPlaneRepository,
  type ResolvedRouteSecretReference,
} from "./repository.js";
import { LlmEndpointPolicy } from "./endpoint-policy.js";
import { validatePromptTemplateVersion } from "./template.js";
import type { SqlConnectionPool, SqlTransactionClient } from "../../persistence/sql-executor.js";

interface SnapshotRow extends Record<string, unknown> {
  readonly snapshot: RoutingSnapshot;
}

interface RuntimeCredentialRow extends Record<string, unknown> {
  readonly id: string;
  readonly provider_id: string;
  readonly key_version: number;
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly auth_tag: Buffer;
}

interface AuditRow extends Record<string, unknown> {
  readonly id: string;
  readonly action: string;
  readonly target_id: string;
  readonly revision: number;
  readonly actor_user_id: string;
  readonly metadata: AuditRecord["metadata"];
}

function assertCiphertext(ciphertext: CredentialCiphertext): void {
  if (ciphertext.nonce.length !== 12 || ciphertext.authTag.length !== 16 || ciphertext.ciphertext.length === 0) {
    throw new Error("encrypted credential payload is invalid");
  }
}

function copyCiphertext(ciphertext: CredentialCiphertext): CredentialCiphertext {
  return {
    nonce: Buffer.from(ciphertext.nonce),
    ciphertext: Buffer.from(ciphertext.ciphertext),
    authTag: Buffer.from(ciphertext.authTag),
  };
}

/**
 * PostgreSQL implementation. All values are bind parameters and every routing
 * mutation commits a secret-free, immutable snapshot revision transactionally.
 */
export class PostgresLlmControlPlaneRepository implements LlmControlPlaneRepository {
  constructor(
    private readonly pool: SqlConnectionPool,
    private readonly endpointPolicy = new LlmEndpointPolicy([
      "platform.rainflowtb.com",
      "api.openai.com",
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
    ]),
  ) {}

  async upsertProvider(provider: Provider): Promise<void> {
    validateProvider(provider);
    await this.pool.query(
      `INSERT INTO llm_providers (id, name, kind, enabled)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, enabled = EXCLUDED.enabled`,
      [provider.id, provider.name, provider.kind, provider.enabled],
    );
  }

  async upsertEndpoint(endpoint: Endpoint): Promise<void> {
    validateEndpoint(endpoint);
    const normalizedEndpoint: Endpoint = {
      ...endpoint,
      baseUrl: this.endpointPolicy.normalizeEndpoint(endpoint.baseUrl),
    };
    await this.pool.query(
      `INSERT INTO llm_endpoints (id, provider_id, base_url, enabled)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE SET provider_id = EXCLUDED.provider_id, base_url = EXCLUDED.base_url, enabled = EXCLUDED.enabled`,
      [
        normalizedEndpoint.id,
        normalizedEndpoint.providerId,
        normalizedEndpoint.baseUrl,
        normalizedEndpoint.enabled,
      ],
    );
  }

  async writeEncryptedCredential(credential: Credential, ciphertext: CredentialCiphertext): Promise<void> {
    validateCredential(credential);
    assertCiphertext(ciphertext);
    await this.pool.query(
      `INSERT INTO llm_credentials (id, provider_id, endpoint_id, key_version, enabled, nonce, ciphertext, auth_tag)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET provider_id = EXCLUDED.provider_id, endpoint_id = EXCLUDED.endpoint_id,
  key_version = EXCLUDED.key_version, enabled = EXCLUDED.enabled, nonce = EXCLUDED.nonce,
  ciphertext = EXCLUDED.ciphertext, auth_tag = EXCLUDED.auth_tag`,
      [
        credential.id,
        credential.providerId,
        credential.endpointId,
        credential.keyVersion,
        credential.enabled,
        ciphertext.nonce,
        ciphertext.ciphertext,
        ciphertext.authTag,
      ],
    );
  }

  async upsertModel(model: Model): Promise<void> {
    validateModel(model);
    await this.pool.query(
      `INSERT INTO llm_models (id, provider_id, endpoint_id, name, enabled)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO UPDATE SET provider_id = EXCLUDED.provider_id, endpoint_id = EXCLUDED.endpoint_id,
  name = EXCLUDED.name, enabled = EXCLUDED.enabled`,
      [model.id, model.providerId, model.endpointId, model.name, model.enabled],
    );
  }

  async setRoute(route: Route, expectedRevision: number): Promise<number> {
    validateRoute(route);
    return this.withRoutingTransaction(route.scope, expectedRevision, async (client, nextRevision) => {
      const relationshipResult = await client.query(
        `SELECT provider.id
FROM llm_providers AS provider
INNER JOIN llm_endpoints AS endpoint
  ON endpoint.id = $2 AND endpoint.provider_id = provider.id
INNER JOIN llm_credentials AS credential
  ON credential.id = $3 AND credential.provider_id = provider.id AND credential.endpoint_id = endpoint.id
INNER JOIN llm_models AS model
  ON model.id = $4 AND model.provider_id = provider.id AND model.endpoint_id = endpoint.id
WHERE provider.id = $1
  AND provider.enabled = TRUE
  AND endpoint.enabled = TRUE
  AND credential.enabled = TRUE
  AND model.enabled = TRUE
FOR KEY SHARE OF provider, endpoint, credential, model`,
        [route.providerId, route.endpointId, route.credentialId, route.modelId],
      );
      if (relationshipResult.rowCount !== 1) {
        throw new Error("route references missing, disabled, or inconsistent resources");
      }
      await client.query(
        `INSERT INTO llm_routes (id, scope, priority, provider_id, endpoint_id, credential_id, model_id, enabled, attempt_timeout_ms, max_response_body_bytes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (id) DO UPDATE SET scope = EXCLUDED.scope, priority = EXCLUDED.priority,
  provider_id = EXCLUDED.provider_id, endpoint_id = EXCLUDED.endpoint_id, credential_id = EXCLUDED.credential_id,
  model_id = EXCLUDED.model_id, enabled = EXCLUDED.enabled, attempt_timeout_ms = EXCLUDED.attempt_timeout_ms,
  max_response_body_bytes = EXCLUDED.max_response_body_bytes`,
        [
          route.id,
          route.scope,
          route.priority,
          route.providerId,
          route.endpointId,
          route.credentialId,
          route.modelId,
          route.enabled,
          route.attemptTimeoutMs,
          route.maxResponseBodyBytes,
        ],
      );
      return nextRevision;
    });
  }

  async saveDraftTemplate(template: PromptTemplateVersion): Promise<void> {
    validatePromptTemplateVersion(template);
    if (template.status !== "draft") {
      throw new Error("only draft templates may be created");
    }
    await this.pool.query(
      `INSERT INTO llm_prompt_template_versions (id, key, version, status, content, checksum)
VALUES ($1, $2, $3, $4, $5, $6)`,
      [template.id, template.key, template.version, template.status, template.content, template.checksum],
    );
  }

  async activateTemplate(
    key: PromptTemplateVersion["key"],
    version: number,
    expectedRevision: number,
  ): Promise<number> {
    if (key !== "player_bet" || !Number.isSafeInteger(version) || version <= 0) {
      throw new Error("prompt template activation request is invalid");
    }
    return this.withRoutingTransaction(key, expectedRevision, async (client, nextRevision) => {
      await client.query(
        `UPDATE llm_prompt_template_versions
SET status = 'archived'
WHERE key = $1 AND status = 'active'`,
        [key],
      );
      const activationResult = await client.query(
        `UPDATE llm_prompt_template_versions
SET status = 'active'
WHERE key = $1 AND version = $2 AND status = 'draft'`,
        [key, version],
      );
      if (activationResult.rowCount !== 1) {
        throw new Error("draft prompt template version does not exist");
      }
      return nextRevision;
    });
  }

  async readRoutingSnapshot(scope: LlmRouteScope, revision?: number): Promise<RoutingSnapshot> {
    if (scope !== "player_bet") {
      throw new Error("routing scope is invalid");
    }
    const result = await this.pool.query<SnapshotRow>(
      revision === undefined
        ? `SELECT snapshot
FROM llm_routing_revisions
WHERE scope = $1
ORDER BY revision DESC
LIMIT 1`
        : `SELECT snapshot
FROM llm_routing_revisions
WHERE scope = $1 AND revision = $2`,
      revision === undefined ? [scope] : [scope, revision],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("routing revision was not found");
    }
    return structuredClone(row.snapshot);
  }

  async getCredentialCiphertextForRuntime(
    credentialId: string,
  ): Promise<ResolvedRouteSecretReference | undefined> {
    requireNonEmptyIdentifier(credentialId, "credentialId");
    const result = await this.pool.query<RuntimeCredentialRow>(
      `SELECT id, provider_id, key_version, nonce, ciphertext, auth_tag
FROM llm_credentials
WHERE id = $1 AND enabled = TRUE`,
      [credentialId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      credentialId: row.id,
      providerId: row.provider_id,
      keyVersion: row.key_version,
      ciphertext: copyCiphertext({ nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag }),
    };
  }

  async appendAudit(auditRecord: AuditRecord): Promise<void> {
    validateAuditRecord(auditRecord);
    await this.pool.query(
      `INSERT INTO llm_configuration_audit_log (id, action, target_id, revision, actor_user_id, metadata)
VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        auditRecord.id,
        auditRecord.action,
        auditRecord.targetId,
        auditRecord.revision,
        auditRecord.actorUserId,
        JSON.stringify(auditRecord.metadata),
      ],
    );
  }

  async listAudit(limit = 100): Promise<readonly AuditRecord[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
      throw new Error("audit limit is invalid");
    }
    const result = await this.pool.query<AuditRow>(
      `SELECT id, action, target_id, revision, actor_user_id, metadata
FROM llm_configuration_audit_log
ORDER BY created_at DESC
LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetId: row.target_id,
      revision: row.revision,
      actorUserId: row.actor_user_id,
      metadata: structuredClone(row.metadata),
    }));
  }

  private async withRoutingTransaction(
    scope: LlmRouteScope,
    expectedRevision: number,
    mutation: (client: SqlTransactionClient, nextRevision: number) => Promise<number>,
  ): Promise<number> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new LlmRoutingRevisionConflictError();
    }
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const nextRevision = expectedRevision + 1;
      const mutationResult = await mutation(client, nextRevision);
      const revisionResult = await client.query(
        `INSERT INTO llm_routing_revisions (scope, revision, snapshot)
SELECT $1, $2, jsonb_strip_nulls(jsonb_build_object(
  'revision', $2,
  'scope', $1,
  'routes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'scope', scope, 'priority', priority, 'providerId', provider_id,
      'endpointId', endpoint_id, 'credentialId', credential_id, 'modelId', model_id,
      'enabled', enabled, 'attemptTimeoutMs', attempt_timeout_ms,
      'maxResponseBodyBytes', max_response_body_bytes
    ) ORDER BY priority)
    FROM llm_routes
    WHERE scope = $1 AND enabled = TRUE
  ), '[]'::jsonb),
  'activeTemplate', (
    SELECT jsonb_build_object('id', id, 'key', key, 'version', version, 'status', status,
      'content', content, 'checksum', checksum)
    FROM llm_prompt_template_versions
    WHERE key = $1 AND status = 'active'
  )
))
WHERE COALESCE((SELECT MAX(revision) FROM llm_routing_revisions WHERE scope = $1), 0) = $3`,
        [scope, nextRevision, expectedRevision],
      );
      if (revisionResult.rowCount !== 1) {
        throw new LlmRoutingRevisionConflictError();
      }
      await client.query("COMMIT");
      transactionStarted = false;
      return mutationResult;
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
