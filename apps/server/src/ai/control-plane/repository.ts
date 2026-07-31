import type {
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

export interface LlmControlPlaneRepository {
  upsertProvider(provider: Provider): Promise<void>;
  upsertEndpoint(endpoint: Endpoint): Promise<void>;
  writeEncryptedCredential(credential: Credential, ciphertext: CredentialCiphertext): Promise<void>;
  upsertModel(model: Model): Promise<void>;
  setRoute(route: Route, expectedRevision: number): Promise<number>;
  saveDraftTemplate(template: PromptTemplateVersion): Promise<void>;
  activateTemplate(
    key: PromptTemplateVersion["key"],
    version: number,
    expectedRevision: number,
  ): Promise<number>;
  readRoutingSnapshot(scope: LlmRouteScope, revision?: number): Promise<RoutingSnapshot>;
  getCredentialCiphertextForRuntime(
    credentialId: string,
  ): Promise<ResolvedRouteSecretReference | undefined>;
  appendAudit(auditRecord: AuditRecord): Promise<void>;
  listAudit(limit?: number): Promise<readonly AuditRecord[]>;
}
