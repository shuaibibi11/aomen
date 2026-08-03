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
import type {
  CredentialCiphertext,
  EffectiveMutationRequest,
  LlmControlPlaneRepository,
  MutationAuditContext,
} from "./repository.js";

/**
 * The only administrator write boundary for routing configuration. Effective
 * resource changes always carry an optimistic revision and audit context; the
 * repository persists data, snapshot, revision, and audit in one transaction.
 */
export class LlmControlPlaneService {
  constructor(private readonly repository: LlmControlPlaneRepository) {}

  async createProvider(provider: Provider): Promise<void> {
    await this.repository.createProvider(provider);
  }

  async createEndpoint(endpoint: Endpoint): Promise<void> {
    await this.repository.createEndpoint(endpoint);
  }

  async createCredential(
    credential: Credential,
    ciphertext: CredentialCiphertext,
  ): Promise<void> {
    await this.repository.createEncryptedCredential(credential, ciphertext);
  }

  async createModel(model: Model): Promise<void> {
    await this.repository.createModel(model);
  }

  async createDraftTemplate(template: PromptTemplateVersion): Promise<void> {
    await this.repository.createDraftTemplate(template);
  }

  async updateProvider(provider: Provider, request: EffectiveMutationRequest): Promise<number> {
    return this.repository.applyEffectiveMutation({ kind: "provider.update", provider }, request);
  }

  async updateEndpoint(endpoint: Endpoint, request: EffectiveMutationRequest): Promise<number> {
    return this.repository.applyEffectiveMutation({ kind: "endpoint.update", endpoint }, request);
  }

  async setCredentialEnabled(
    credentialId: string,
    enabled: boolean,
    request: EffectiveMutationRequest,
  ): Promise<number> {
    return this.repository.applyEffectiveMutation(
      { kind: "credential.enabled", credentialId, enabled },
      request,
    );
  }

  async updateModel(model: Model, request: EffectiveMutationRequest): Promise<number> {
    return this.repository.applyEffectiveMutation({ kind: "model.update", model }, request);
  }

  async setRoute(route: Route, request: EffectiveMutationRequest): Promise<number> {
    return this.repository.applyEffectiveMutation({ kind: "route.set", route }, request);
  }

  async activateTemplate(
    key: PromptTemplateVersion["key"],
    version: number,
    request: EffectiveMutationRequest,
  ): Promise<number> {
    return this.repository.applyEffectiveMutation(
      { kind: "template.activate", key, version },
      request,
    );
  }

  async readRoutingSnapshot(scope: LlmRouteScope, revision?: number): Promise<RoutingSnapshot> {
    return this.repository.readRoutingSnapshot(scope, revision);
  }

  async listAudit(limit?: number): Promise<readonly AuditRecord[]> {
    return this.repository.listAudit(limit);
  }
}

export type { EffectiveMutationRequest, MutationAuditContext };
