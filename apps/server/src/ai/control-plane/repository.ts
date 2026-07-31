import type {
  AuditMetadata,
  AuditRecord,
  Credential,
  Endpoint,
  LlmRouteScope,
  Model,
  PromptTemplateVersion,
  Provider,
  Route,
  RoutingSnapshot,
} from "./domain.js";

export interface CredentialCiphertext {
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
}

/** Narrow runtime-only lookup result; never expose this through administrator reads. */
export interface ResolvedRouteSecretReference {
  readonly credentialId: string;
  readonly providerId: string;
  readonly keyVersion: number;
  readonly ciphertext: CredentialCiphertext;
}

export class LlmRoutingRevisionConflictError extends Error {
  constructor() {
    super("LLM routing revision conflict");
    this.name = "LlmRoutingRevisionConflictError";
  }
}

/** The caller identity and secret-free explanation required for every effective change. */
export interface MutationAuditContext {
  readonly actorUserId: string;
  readonly action: string;
  readonly safeMetadata: AuditMetadata;
}

export interface EffectiveMutationRequest {
  readonly expectedRevision: number;
  readonly audit: MutationAuditContext;
}

/**
 * A configuration change that can affect whether an existing route is
 * executable. Repositories apply this as one transaction with its revision,
 * immutable snapshot, and audit entry.
 */
export type EffectiveRoutingMutation =
  | { readonly kind: "provider.update"; readonly provider: Provider }
  | { readonly kind: "endpoint.update"; readonly endpoint: Endpoint }
  | { readonly kind: "credential.enabled"; readonly credentialId: string; readonly enabled: boolean }
  | { readonly kind: "model.update"; readonly model: Model }
  | { readonly kind: "route.set"; readonly route: Route }
  | { readonly kind: "template.activate"; readonly key: PromptTemplateVersion["key"]; readonly version: number };

export interface LlmControlPlaneRepository {
  /** Creation is permitted without a revision only while the resource is unreferenced. */
  createProvider(provider: Provider): Promise<void>;
  createEndpoint(endpoint: Endpoint): Promise<void>;
  createEncryptedCredential(credential: Credential, ciphertext: CredentialCiphertext): Promise<void>;
  createModel(model: Model): Promise<void>;
  createDraftTemplate(template: PromptTemplateVersion): Promise<void>;
  applyEffectiveMutation(
    mutation: EffectiveRoutingMutation,
    request: EffectiveMutationRequest,
  ): Promise<number>;
  readRoutingSnapshot(scope: LlmRouteScope, revision?: number): Promise<RoutingSnapshot>;
  /** Runtime-only lookup. It is never an administrator read model. */
  getCredentialCiphertextForRuntime(
    credentialId: string,
  ): Promise<ResolvedRouteSecretReference | undefined>;
  listAudit(limit?: number): Promise<readonly AuditRecord[]>;
}
