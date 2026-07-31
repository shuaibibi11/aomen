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
  type RoutingSnapshot,
} from "./domain.js";
import {
  LlmRoutingRevisionConflictError,
  type CredentialCiphertext,
  type EffectiveMutationRequest,
  type EffectiveRoutingMutation,
  type LlmControlPlaneRepository,
  type ResolvedRouteSecretReference,
} from "./repository.js";
import { LlmEndpointPolicy } from "./endpoint-policy.js";
import { validatePromptTemplateVersion } from "./template.js";
import type { SqlConnectionPool, SqlTransactionClient } from "../../persistence/sql-executor.js";
import { randomUUID } from "node:crypto";

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
  readonly revision: string | number;
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

function parseSafeRevision(value: string | number, fieldName = "revision"): number {
  const parsedRevision = typeof value === "number"
    ? value
    : /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsedRevision) || parsedRevision < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return parsedRevision;
}

function freezeRoutingSnapshot(snapshot: RoutingSnapshot): RoutingSnapshot {
  const frozenRoutes = snapshot.routes.map((route) => Object.freeze({ ...route }));
  const frozenTemplate = snapshot.activeTemplate === null
    ? null
    : Object.freeze({ ...snapshot.activeTemplate });
  return Object.freeze({
    revision: parseSafeRevision(snapshot.revision),
    scope: snapshot.scope,
    activeTemplate: frozenTemplate,
    routes: Object.freeze(frozenRoutes),
  });
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

  async createProvider(provider: Provider): Promise<void> {
    validateProvider(provider);
    await this.pool.query(
      `INSERT INTO llm_providers (id, name, kind, enabled)
VALUES ($1, $2, $3, $4)`,
      [provider.id, provider.name, provider.kind, provider.enabled],
    );
  }

  async createEndpoint(endpoint: Endpoint): Promise<void> {
    validateEndpoint(endpoint);
    const normalizedEndpoint: Endpoint = {
      ...endpoint,
      baseUrl: this.endpointPolicy.normalizeEndpoint(endpoint.baseUrl),
    };
    await this.pool.query(
      `INSERT INTO llm_endpoints (id, provider_id, base_url, enabled)
VALUES ($1, $2, $3, $4)`,
      [
        normalizedEndpoint.id,
        normalizedEndpoint.providerId,
        normalizedEndpoint.baseUrl,
        normalizedEndpoint.enabled,
      ],
    );
  }

  async createEncryptedCredential(credential: Credential, ciphertext: CredentialCiphertext): Promise<void> {
    validateCredential(credential);
    assertCiphertext(ciphertext);
    await this.pool.query(
      `INSERT INTO llm_credentials (id, provider_id, endpoint_id, key_version, enabled, nonce, ciphertext, auth_tag)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

  async createModel(model: Model): Promise<void> {
    validateModel(model);
    await this.pool.query(
      `INSERT INTO llm_models (id, provider_id, endpoint_id, name, enabled)
VALUES ($1, $2, $3, $4, $5)`,
      [model.id, model.providerId, model.endpointId, model.name, model.enabled],
    );
  }

  async createDraftTemplate(template: PromptTemplateVersion): Promise<void> {
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

  async applyEffectiveMutation(
    mutation: EffectiveRoutingMutation,
    request: EffectiveMutationRequest,
  ): Promise<number> {
    let expectedRevision: number;
    try {
      expectedRevision = parseSafeRevision(request.expectedRevision, "expectedRevision");
    } catch {
      throw new LlmRoutingRevisionConflictError();
    }
    const nextRevision = expectedRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      throw new LlmRoutingRevisionConflictError();
    }
    const auditRecord: AuditRecord = {
      id: randomUUID(),
      action: request.audit.action,
      targetId: this.getMutationTargetId(mutation),
      revision: nextRevision,
      actorUserId: request.audit.actorUserId,
      metadata: request.audit.safeMetadata,
    };
    validateAuditRecord(auditRecord);
    return this.withRoutingTransaction("player_bet", expectedRevision, auditRecord, async (client) => {
      await this.applyMutation(client, mutation);
    });
  }

  async readRoutingSnapshot(scope: LlmRouteScope, revision?: number): Promise<RoutingSnapshot> {
    if (scope !== "player_bet") {
      throw new Error("routing scope is invalid");
    }
    const result = await this.pool.query<SnapshotRow>(
      revision === undefined
        ? `SELECT snapshot.snapshot
FROM llm_routing_revisions AS revision
INNER JOIN llm_routing_snapshots AS snapshot
  ON snapshot.scope = revision.scope AND snapshot.revision = revision.revision
WHERE revision.scope = $1`
        : `SELECT snapshot
FROM llm_routing_snapshots
WHERE scope = $1 AND revision = $2`,
      revision === undefined ? [scope] : [scope, revision],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("routing revision was not found");
    }
    return freezeRoutingSnapshot(structuredClone(row.snapshot));
  }

  async getCredentialCiphertextForRuntime(
    credentialId: string,
  ): Promise<ResolvedRouteSecretReference | undefined> {
    requireNonEmptyIdentifier(credentialId, "credentialId");
    const result = await this.pool.query<RuntimeCredentialRow>(
      `SELECT id, provider_id, key_version, nonce, ciphertext, auth_tag
FROM llm_credentials
WHERE id = $1`,
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
    return result.rows.map((row) => {
      const auditRecord: AuditRecord = {
        id: row.id,
        action: row.action,
        targetId: row.target_id,
        revision: parseSafeRevision(row.revision),
        actorUserId: row.actor_user_id,
        metadata: structuredClone(row.metadata),
      };
      validateAuditRecord(auditRecord);
      return auditRecord;
    });
  }

  private async applyMutation(
    client: SqlTransactionClient,
    mutation: EffectiveRoutingMutation,
  ): Promise<void> {
    switch (mutation.kind) {
      case "provider.update": {
        validateProvider(mutation.provider);
        const result = await client.query(
          `UPDATE llm_providers
SET name = $2, kind = $3, enabled = $4, updated_at = NOW()
WHERE id = $1`,
          [
            mutation.provider.id,
            mutation.provider.name,
            mutation.provider.kind,
            mutation.provider.enabled,
          ],
        );
        this.requireSingleUpdatedResource(result.rowCount, "provider");
        return;
      }
      case "endpoint.update": {
        validateEndpoint(mutation.endpoint);
        const normalizedEndpointUrl = this.endpointPolicy.normalizeEndpoint(mutation.endpoint.baseUrl);
        const result = await client.query(
          `UPDATE llm_endpoints
SET base_url = $3, enabled = $4, updated_at = NOW()
WHERE id = $1 AND provider_id = $2`,
          [
            mutation.endpoint.id,
            mutation.endpoint.providerId,
            normalizedEndpointUrl,
            mutation.endpoint.enabled,
          ],
        );
        this.requireSingleUpdatedResource(result.rowCount, "endpoint");
        return;
      }
      case "credential.enabled": {
        requireNonEmptyIdentifier(mutation.credentialId, "credentialId");
        if (typeof mutation.enabled !== "boolean") {
          throw new Error("credential enabled status is invalid");
        }
        const result = await client.query(
          `UPDATE llm_credentials
SET enabled = $2, updated_at = NOW()
WHERE id = $1`,
          [mutation.credentialId, mutation.enabled],
        );
        this.requireSingleUpdatedResource(result.rowCount, "credential");
        return;
      }
      case "model.update": {
        validateModel(mutation.model);
        const result = await client.query(
          `UPDATE llm_models
SET name = $4, enabled = $5, updated_at = NOW()
WHERE id = $1 AND provider_id = $2 AND endpoint_id = $3`,
          [
            mutation.model.id,
            mutation.model.providerId,
            mutation.model.endpointId,
            mutation.model.name,
            mutation.model.enabled,
          ],
        );
        this.requireSingleUpdatedResource(result.rowCount, "model");
        return;
      }
      case "route.set": {
        validateRoute(mutation.route);
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
          [
            mutation.route.providerId,
            mutation.route.endpointId,
            mutation.route.credentialId,
            mutation.route.modelId,
          ],
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
  max_response_body_bytes = EXCLUDED.max_response_body_bytes, updated_at = NOW()`,
          [
            mutation.route.id,
            mutation.route.scope,
            mutation.route.priority,
            mutation.route.providerId,
            mutation.route.endpointId,
            mutation.route.credentialId,
            mutation.route.modelId,
            mutation.route.enabled,
            mutation.route.attemptTimeoutMs,
            mutation.route.maxResponseBodyBytes,
          ],
        );
        return;
      }
      case "template.activate": {
        if (
          mutation.key !== "player_bet" ||
          !Number.isSafeInteger(mutation.version) ||
          mutation.version <= 0
        ) {
          throw new Error("prompt template activation request is invalid");
        }
        await client.query(
          `UPDATE llm_prompt_template_versions
SET status = 'archived'
WHERE key = $1 AND status = 'active'`,
          [mutation.key],
        );
        const activationResult = await client.query(
          `UPDATE llm_prompt_template_versions
SET status = 'active'
WHERE key = $1 AND version = $2 AND status = 'draft'`,
          [mutation.key, mutation.version],
        );
        this.requireSingleUpdatedResource(activationResult.rowCount, "draft prompt template version");
        return;
      }
    }
  }

  private getMutationTargetId(mutation: EffectiveRoutingMutation): string {
    switch (mutation.kind) {
      case "provider.update": return mutation.provider.id;
      case "endpoint.update": return mutation.endpoint.id;
      case "credential.enabled": return mutation.credentialId;
      case "model.update": return mutation.model.id;
      case "route.set": return mutation.route.id;
      case "template.activate": return `${mutation.key}:${mutation.version}`;
    }
  }

  private requireSingleUpdatedResource(rowCount: number | null | undefined, resourceName: string): void {
    if (rowCount !== 1) {
      throw new Error(`${resourceName} does not exist or has immutable bindings`);
    }
  }

  private async withRoutingTransaction(
    scope: LlmRouteScope,
    expectedRevision: number,
    auditRecord: AuditRecord,
    mutation: (client: SqlTransactionClient) => Promise<void>,
  ): Promise<number> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new LlmRoutingRevisionConflictError();
    }
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const lockedRevisionResult = await client.query<{ revision: string | number }>(
        `SELECT revision
FROM llm_routing_revisions
WHERE scope = $1
FOR UPDATE`,
        [scope],
      );
      const lockedRevision = lockedRevisionResult.rows[0];
      if (
        lockedRevision === undefined ||
        parseSafeRevision(lockedRevision.revision) !== expectedRevision
      ) {
        throw new LlmRoutingRevisionConflictError();
      }
      const nextRevision = expectedRevision + 1;

      await mutation(client);

      const revisionResult = await client.query(
        `UPDATE llm_routing_revisions
SET revision = $2
WHERE scope = $1 AND revision = $3`,
        [scope, nextRevision, expectedRevision],
      );
      if (revisionResult.rowCount !== 1) {
        throw new LlmRoutingRevisionConflictError();
      }

      const snapshotResult = await client.query(
        `INSERT INTO llm_routing_snapshots (scope, revision, snapshot)
SELECT $1, $2, jsonb_build_object(
  'revision', $2,
  'scope', $1,
  'routes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', route.id,
      'scope', route.scope,
      'priority', route.priority,
      'providerId', provider.id,
      'endpointId', endpoint.id,
      'modelId', model.id,
      'credentialId', credential.id,
      'providerKind', provider.kind,
      'endpointUrl', endpoint.base_url,
      'upstreamModelName', model.name,
      'credentialKeyVersion', credential.key_version,
      'attemptTimeoutMs', route.attempt_timeout_ms,
      'maxResponseBodyBytes', route.max_response_body_bytes
    ) ORDER BY route.priority)
    FROM llm_routes AS route
    INNER JOIN llm_providers AS provider ON provider.id = route.provider_id
    INNER JOIN llm_endpoints AS endpoint ON endpoint.id = route.endpoint_id AND endpoint.provider_id = provider.id
    INNER JOIN llm_credentials AS credential ON credential.id = route.credential_id
      AND credential.provider_id = provider.id AND credential.endpoint_id = endpoint.id
    INNER JOIN llm_models AS model ON model.id = route.model_id
      AND model.provider_id = provider.id AND model.endpoint_id = endpoint.id
    WHERE route.scope = $1
      AND route.enabled = TRUE
      AND provider.enabled = TRUE
      AND endpoint.enabled = TRUE
      AND credential.enabled = TRUE
      AND model.enabled = TRUE
  ), '[]'::jsonb),
  'activeTemplate', COALESCE((
    SELECT jsonb_build_object(
      'version', version,
      'checksum', checksum,
      'content', content
    )
    FROM llm_prompt_template_versions
    WHERE key = $1 AND status = 'active'
  ), 'null'::jsonb)
)
ON CONFLICT (scope, revision) DO NOTHING`,
        [scope, nextRevision],
      );
      if (snapshotResult.rowCount !== 1) {
        throw new LlmRoutingRevisionConflictError();
      }

      await client.query(
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
      await client.query("COMMIT");
      transactionStarted = false;
      return nextRevision;
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }
      if (this.isPostgresUniqueViolation(error)) {
        throw new LlmRoutingRevisionConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private isPostgresUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null &&
      "code" in error && (error as { readonly code?: unknown }).code === "23505";
  }
}
