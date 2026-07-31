export type LlmProviderKind =
  | "openai_compatible"
  | "anthropic_messages"
  | "gemini_generate_content";

export type LlmRouteScope = "player_bet";
export type PromptTemplateStatus = "draft" | "active" | "archived";

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly kind: LlmProviderKind;
  readonly enabled: boolean;
}

export interface Endpoint {
  readonly id: string;
  readonly providerId: string;
  readonly baseUrl: string;
  readonly enabled: boolean;
}

/** Administrative credential projection. It deliberately has no secret fields. */
export interface Credential {
  readonly id: string;
  readonly providerId: string;
  readonly endpointId: string;
  readonly keyVersion: number;
  readonly enabled: boolean;
}

export interface Model {
  readonly id: string;
  readonly providerId: string;
  readonly endpointId: string;
  readonly name: string;
  readonly enabled: boolean;
}

export interface Route {
  readonly id: string;
  readonly scope: LlmRouteScope;
  readonly priority: number;
  readonly providerId: string;
  readonly endpointId: string;
  readonly credentialId: string;
  readonly modelId: string;
  readonly enabled: boolean;
  readonly attemptTimeoutMs: number;
  readonly maxResponseBodyBytes: number;
}

export interface PromptTemplateVersion {
  readonly id: string;
  readonly key: "player_bet";
  readonly version: number;
  readonly status: PromptTemplateStatus;
  readonly content: string;
  readonly checksum: string;
}

/**
 * Runtime-only route data captured at one routing revision. These fields are
 * copied from their source records so a request never needs to re-read mutable
 * provider, endpoint, model, or credential configuration.
 */
export interface ResolvedRoute {
  readonly id: string;
  readonly scope: LlmRouteScope;
  readonly priority: number;
  readonly providerId: string;
  readonly endpointId: string;
  readonly modelId: string;
  readonly credentialId: string;
  readonly providerKind: LlmProviderKind;
  readonly endpointUrl: string;
  readonly upstreamModelName: string;
  readonly credentialKeyVersion: number;
  readonly attemptTimeoutMs: number;
  readonly maxResponseBodyBytes: number;
}

/** The immutable content copy available to a routing request. */
export interface ActivePromptTemplateSnapshot {
  readonly version: number;
  readonly checksum: string;
  readonly content: string;
}

/**
 * Internal runtime read model. This deliberately differs from administrator
 * resource projections and never contains plaintext secrets or ciphertext.
 */
export interface RoutingSnapshot {
  readonly revision: number;
  readonly scope: LlmRouteScope;
  readonly activeTemplate: ActivePromptTemplateSnapshot | null;
  readonly routes: readonly ResolvedRoute[];
}

export interface AuditMetadata {
  readonly changedFields?: readonly string[];
  readonly reasonCode?: string;
  readonly sourceRevision?: number;
}

export interface AuditRecord {
  readonly id: string;
  readonly action: string;
  readonly targetId: string;
  readonly revision: number;
  readonly actorUserId: string;
  readonly metadata: AuditMetadata;
}

export const MIN_ROUTE_ATTEMPT_TIMEOUT_MS = 1;
export const MAX_ROUTE_ATTEMPT_TIMEOUT_MS = 30_000;
export const MIN_ROUTE_RESPONSE_BODY_BYTES = 1024;
export const MAX_ROUTE_RESPONSE_BODY_BYTES = 1024 * 1024;

const PROVIDER_KINDS = new Set<LlmProviderKind>([
  "openai_compatible",
  "anthropic_messages",
  "gemini_generate_content",
]);

const AUDIT_METADATA_ALLOWED_KEYS = new Set(["changedFields", "reasonCode", "sourceRevision"]);
const SECRET_METADATA_KEY_PATTERN = /secret|key|token|authorization|password/i;

export function requireNonEmptyIdentifier(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function requirePositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

export function validateProvider(provider: Provider): Provider {
  requireNonEmptyIdentifier(provider.id, "provider.id");
  requireNonEmptyIdentifier(provider.name, "provider.name");
  if (!PROVIDER_KINDS.has(provider.kind)) {
    throw new Error("provider.kind is invalid");
  }
  return provider;
}

export function validateEndpoint(endpoint: Endpoint): Endpoint {
  requireNonEmptyIdentifier(endpoint.id, "endpoint.id");
  requireNonEmptyIdentifier(endpoint.providerId, "endpoint.providerId");
  requireNonEmptyIdentifier(endpoint.baseUrl, "endpoint.baseUrl");
  return endpoint;
}

export function validateCredential(credential: Credential): Credential {
  requireNonEmptyIdentifier(credential.id, "credential.id");
  requireNonEmptyIdentifier(credential.providerId, "credential.providerId");
  requireNonEmptyIdentifier(credential.endpointId, "credential.endpointId");
  requirePositiveSafeInteger(credential.keyVersion, "credential.keyVersion");
  return credential;
}

export function validateModel(model: Model): Model {
  requireNonEmptyIdentifier(model.id, "model.id");
  requireNonEmptyIdentifier(model.providerId, "model.providerId");
  requireNonEmptyIdentifier(model.endpointId, "model.endpointId");
  requireNonEmptyIdentifier(model.name, "model.name");
  return model;
}

/** Validates route-local invariants; repositories validate linked resources. */
export function validateRoute(route: Route): Route {
  requireNonEmptyIdentifier(route.id, "route.id");
  requireNonEmptyIdentifier(route.providerId, "route.providerId");
  requireNonEmptyIdentifier(route.endpointId, "route.endpointId");
  requireNonEmptyIdentifier(route.credentialId, "route.credentialId");
  requireNonEmptyIdentifier(route.modelId, "route.modelId");
  requirePositiveSafeInteger(route.priority, "route.priority");
  if (route.scope !== "player_bet") {
    throw new Error("route.scope is invalid");
  }
  if (
    !Number.isSafeInteger(route.attemptTimeoutMs) ||
    route.attemptTimeoutMs < MIN_ROUTE_ATTEMPT_TIMEOUT_MS ||
    route.attemptTimeoutMs > MAX_ROUTE_ATTEMPT_TIMEOUT_MS
  ) {
    throw new Error("route.attemptTimeoutMs is outside the safe range");
  }
  if (
    !Number.isSafeInteger(route.maxResponseBodyBytes) ||
    route.maxResponseBodyBytes < MIN_ROUTE_RESPONSE_BODY_BYTES ||
    route.maxResponseBodyBytes > MAX_ROUTE_RESPONSE_BODY_BYTES
  ) {
    throw new Error("route.maxResponseBodyBytes is outside the safe range");
  }
  return route;
}

export function validateAuditRecord(auditRecord: AuditRecord): AuditRecord {
  requireNonEmptyIdentifier(auditRecord.id, "audit.id");
  requireNonEmptyIdentifier(auditRecord.action, "audit.action");
  requireNonEmptyIdentifier(auditRecord.targetId, "audit.targetId");
  requireNonEmptyIdentifier(auditRecord.actorUserId, "audit.actorUserId");
  if (!Number.isSafeInteger(auditRecord.revision) || auditRecord.revision < 0) {
    throw new Error("audit.revision must be a non-negative safe integer");
  }

  for (const [metadataKey, metadataValue] of Object.entries(auditRecord.metadata)) {
    if (
      !AUDIT_METADATA_ALLOWED_KEYS.has(metadataKey) ||
      SECRET_METADATA_KEY_PATTERN.test(metadataKey)
    ) {
      throw new Error("audit metadata contains a forbidden key");
    }
    if (metadataKey === "changedFields") {
      if (!Array.isArray(metadataValue) || !metadataValue.every((field) => typeof field === "string" && field.length > 0 && !SECRET_METADATA_KEY_PATTERN.test(field))) {
        throw new Error("audit metadata changedFields is invalid");
      }
    } else if (metadataKey === "reasonCode") {
      if (typeof metadataValue !== "string" || metadataValue.length === 0 || metadataValue.length > 128 || SECRET_METADATA_KEY_PATTERN.test(metadataValue)) {
        throw new Error("audit metadata reasonCode is invalid");
      }
    } else if (metadataKey === "sourceRevision") {
      if (typeof metadataValue !== "number" || !Number.isSafeInteger(metadataValue) || metadataValue < 0) {
        throw new Error("audit metadata sourceRevision is invalid");
      }
    }
  }
  return auditRecord;
}
