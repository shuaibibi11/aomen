import {
  normalizeAuditMetadata,
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
  type ResolvedRoute,
  type Route,
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

interface StoredCredential {
  readonly credential: Credential;
  readonly ciphertext: CredentialCiphertext;
}

function cloneCiphertext(ciphertext: CredentialCiphertext): CredentialCiphertext {
  return {
    nonce: Buffer.from(ciphertext.nonce),
    ciphertext: Buffer.from(ciphertext.ciphertext),
    authTag: Buffer.from(ciphertext.authTag),
  };
}

function cloneAuditRecord(auditRecord: AuditRecord): AuditRecord {
  return {
    ...auditRecord,
    metadata: {
      ...(auditRecord.metadata.changedFields === undefined
        ? {}
        : { changedFields: [...auditRecord.metadata.changedFields] }),
      ...(auditRecord.metadata.reasonCode === undefined
        ? {}
        : { reasonCode: auditRecord.metadata.reasonCode }),
      ...(auditRecord.metadata.sourceRevision === undefined
        ? {}
        : { sourceRevision: auditRecord.metadata.sourceRevision }),
    },
  };
}

/**
 * In-memory test repository. Serialized mutations intentionally model the
 * transaction and optimistic-revision guarantees expected from PostgreSQL.
 */
export class MemoryLlmControlPlaneRepository implements LlmControlPlaneRepository {
  private readonly providers = new Map<string, Provider>();
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly credentials = new Map<string, StoredCredential>();
  private readonly models = new Map<string, Model>();
  private readonly routes = new Map<string, Route>();
  private readonly templates = new Map<number, PromptTemplateVersion>();
  private readonly snapshots = new Map<number, RoutingSnapshot>();
  private readonly auditRecords: AuditRecord[] = [];
  private currentRevision = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly endpointPolicy = new LlmEndpointPolicy([
    "platform.rainflowtb.com",
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
  ])) {
    this.storeSnapshot();
  }

  async createProvider(provider: Provider): Promise<void> {
    validateProvider(provider);
    await this.serializeMutation(() => {
      if (this.providers.has(provider.id)) {
        throw new Error("provider identifier is immutable");
      }
      this.providers.set(provider.id, { ...provider });
    });
  }

  async createEndpoint(endpoint: Endpoint): Promise<void> {
    validateEndpoint(endpoint);
    const normalizedEndpoint: Endpoint = {
      ...endpoint,
      baseUrl: this.endpointPolicy.normalizeEndpoint(endpoint.baseUrl),
    };
    await this.serializeMutation(() => {
      if (this.endpoints.has(normalizedEndpoint.id)) {
        throw new Error("endpoint identifier is immutable");
      }
      const provider = this.providers.get(normalizedEndpoint.providerId);
      if (provider === undefined) {
        throw new Error("endpoint provider does not exist");
      }
      this.endpoints.set(normalizedEndpoint.id, normalizedEndpoint);
    });
  }

  async createEncryptedCredential(
    credential: Credential,
    ciphertext: CredentialCiphertext,
  ): Promise<void> {
    validateCredential(credential);
    if (ciphertext.nonce.length !== 12 || ciphertext.authTag.length !== 16 || ciphertext.ciphertext.length === 0) {
      throw new Error("encrypted credential payload is invalid");
    }
    await this.serializeMutation(() => {
      if (this.credentials.has(credential.id)) {
        throw new Error("credential identifier is immutable");
      }
      const endpoint = this.endpoints.get(credential.endpointId);
      if (endpoint === undefined || endpoint.providerId !== credential.providerId) {
        throw new Error("credential endpoint and provider relationship is invalid");
      }
      this.credentials.set(credential.id, {
        credential: { ...credential },
        ciphertext: cloneCiphertext(ciphertext),
      });
    });
  }

  async createModel(model: Model): Promise<void> {
    validateModel(model);
    await this.serializeMutation(() => {
      if (this.models.has(model.id)) {
        throw new Error("model identifier is immutable");
      }
      const endpoint = this.endpoints.get(model.endpointId);
      if (endpoint === undefined || endpoint.providerId !== model.providerId) {
        throw new Error("model endpoint and provider relationship is invalid");
      }
      this.models.set(model.id, { ...model });
    });
  }

  async createDraftTemplate(template: PromptTemplateVersion): Promise<void> {
    validatePromptTemplateVersion(template);
    if (template.status !== "draft") {
      throw new Error("only draft templates may be created");
    }
    await this.serializeMutation(() => {
      if (this.templates.has(template.version)) {
        throw new Error("prompt template version is immutable and already exists");
      }
      this.templates.set(template.version, { ...template });
    });
  }

  async applyEffectiveMutation(
    mutation: EffectiveRoutingMutation,
    request: EffectiveMutationRequest,
  ): Promise<number> {
    // This copies caller-owned metadata before serializeMutation yields to an
    // earlier mutation. A queued audit must not observe a later caller change.
    const normalizedRequest = this.normalizeEffectiveMutationRequest(request);
    return this.serializeMutation(() => {
      this.requireExpectedRevision(normalizedRequest.expectedRevision);
      const nextRevision = this.currentRevision + 1;
      const auditRecord = this.createAuditRecord(
        mutation,
        normalizedRequest,
        nextRevision,
      );
      this.applyMutation(mutation);
      this.currentRevision = nextRevision;
      this.storeSnapshot();
      this.auditRecords.push(auditRecord);
      return nextRevision;
    });
  }

  async readRoutingSnapshot(scope: LlmRouteScope, revision?: number): Promise<RoutingSnapshot> {
    if (scope !== "player_bet") {
      throw new Error("routing scope is invalid");
    }
    const requestedRevision = revision ?? this.currentRevision;
    if (!Number.isSafeInteger(requestedRevision) || requestedRevision < 0) {
      throw new Error("routing revision is invalid");
    }
    const snapshot = this.snapshots.get(requestedRevision);
    if (snapshot === undefined) {
      throw new Error("routing revision was not found");
    }
    return this.cloneSnapshot(snapshot);
  }

  async getCredentialCiphertextForRuntime(
    credentialId: string,
  ): Promise<ResolvedRouteSecretReference | undefined> {
    requireNonEmptyIdentifier(credentialId, "credentialId");
    const storedCredential = this.credentials.get(credentialId);
    if (storedCredential === undefined) {
      return undefined;
    }
    return {
      credentialId: storedCredential.credential.id,
      providerId: storedCredential.credential.providerId,
      keyVersion: storedCredential.credential.keyVersion,
      ciphertext: cloneCiphertext(storedCredential.ciphertext),
    };
  }

  async listAudit(limit = 100): Promise<readonly AuditRecord[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
      throw new Error("audit limit is invalid");
    }
    return this.auditRecords.slice(-limit).reverse().map(cloneAuditRecord);
  }

  private validateRouteRelationships(route: Route): void {
    const provider = this.providers.get(route.providerId);
    const endpoint = this.endpoints.get(route.endpointId);
    const storedCredential = this.credentials.get(route.credentialId);
    const model = this.models.get(route.modelId);
    if (
      provider === undefined || !provider.enabled ||
      endpoint === undefined || !endpoint.enabled || endpoint.providerId !== provider.id ||
      storedCredential === undefined || !storedCredential.credential.enabled ||
      storedCredential.credential.providerId !== provider.id || storedCredential.credential.endpointId !== endpoint.id ||
      model === undefined || !model.enabled || model.providerId !== provider.id || model.endpointId !== endpoint.id
    ) {
      throw new Error("route references missing, disabled, or inconsistent resources");
    }
  }

  private requireExpectedRevision(expectedRevision: number): void {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== this.currentRevision) {
      throw new LlmRoutingRevisionConflictError();
    }
  }

  private applyMutation(mutation: EffectiveRoutingMutation): void {
    switch (mutation.kind) {
      case "provider.update": {
        validateProvider(mutation.provider);
        if (!this.providers.has(mutation.provider.id)) {
          throw new Error("provider does not exist");
        }
        this.providers.set(mutation.provider.id, { ...mutation.provider });
        return;
      }
      case "endpoint.update": {
        validateEndpoint(mutation.endpoint);
        const existingEndpoint = this.endpoints.get(mutation.endpoint.id);
        if (existingEndpoint === undefined) {
          throw new Error("endpoint does not exist");
        }
        if (existingEndpoint.providerId !== mutation.endpoint.providerId) {
          throw new Error("endpoint provider binding is immutable");
        }
        this.endpoints.set(mutation.endpoint.id, {
          ...mutation.endpoint,
          baseUrl: this.endpointPolicy.normalizeEndpoint(mutation.endpoint.baseUrl),
        });
        return;
      }
      case "credential.enabled": {
        const storedCredential = this.credentials.get(mutation.credentialId);
        if (storedCredential === undefined || typeof mutation.enabled !== "boolean") {
          throw new Error("credential does not exist or enabled status is invalid");
        }
        this.credentials.set(mutation.credentialId, {
          credential: { ...storedCredential.credential, enabled: mutation.enabled },
          ciphertext: cloneCiphertext(storedCredential.ciphertext),
        });
        return;
      }
      case "model.update": {
        validateModel(mutation.model);
        const existingModel = this.models.get(mutation.model.id);
        if (existingModel === undefined) {
          throw new Error("model does not exist");
        }
        if (
          existingModel.providerId !== mutation.model.providerId ||
          existingModel.endpointId !== mutation.model.endpointId
        ) {
          throw new Error("model provider and endpoint bindings are immutable");
        }
        this.models.set(mutation.model.id, { ...mutation.model });
        return;
      }
      case "route.set": {
        validateRoute(mutation.route);
        this.validateRouteRelationships(mutation.route);
        for (const existingRoute of this.routes.values()) {
          if (
            existingRoute.id !== mutation.route.id &&
            existingRoute.scope === mutation.route.scope &&
            existingRoute.priority === mutation.route.priority
          ) {
            throw new Error("route scope and priority must be unique");
          }
        }
        this.routes.set(mutation.route.id, { ...mutation.route });
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
        const template = this.templates.get(mutation.version);
        if (template === undefined || template.key !== mutation.key || template.status !== "draft") {
          throw new Error("draft prompt template version does not exist");
        }
        for (const [existingVersion, existingTemplate] of this.templates) {
          if (existingTemplate.key === mutation.key && existingTemplate.status === "active") {
            this.templates.set(existingVersion, { ...existingTemplate, status: "archived" });
          }
        }
        this.templates.set(mutation.version, { ...template, status: "active" });
        return;
      }
    }
  }

  private createAuditRecord(
    mutation: EffectiveRoutingMutation,
    request: EffectiveMutationRequest,
    revision: number,
  ): AuditRecord {
    const auditRecord: AuditRecord = {
      id: `routing-audit-${revision}`,
      action: request.audit.action,
      targetId: this.getMutationTargetId(mutation),
      revision,
      actorUserId: request.audit.actorUserId,
      metadata: request.audit.safeMetadata,
    };
    validateAuditRecord(auditRecord);
    return cloneAuditRecord(auditRecord);
  }

  private normalizeEffectiveMutationRequest(
    request: EffectiveMutationRequest,
  ): EffectiveMutationRequest {
    return Object.freeze({
      expectedRevision: request.expectedRevision,
      audit: Object.freeze({
        actorUserId: request.audit.actorUserId,
        action: request.audit.action,
        safeMetadata: normalizeAuditMetadata(request.audit.safeMetadata),
      }),
    });
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

  private storeSnapshot(): void {
    const activeTemplate = [...this.templates.values()].find((template) => template.status === "active");
    const routes = [...this.routes.values()]
      .filter((route) => route.scope === "player_bet" && route.enabled)
      .map((route) => this.resolveRoute(route))
      .filter((route): route is ResolvedRoute => route !== undefined)
      .sort((firstRoute, secondRoute) => firstRoute.priority - secondRoute.priority);
    this.snapshots.set(this.currentRevision, this.freezeSnapshot({
      revision: this.currentRevision,
      scope: "player_bet",
      activeTemplate: activeTemplate === undefined
        ? null
        : {
            version: activeTemplate.version,
            checksum: activeTemplate.checksum,
            content: activeTemplate.content,
          },
      routes,
    }));
  }

  private cloneSnapshot(snapshot: RoutingSnapshot): RoutingSnapshot {
    return this.freezeSnapshot({
      revision: snapshot.revision,
      scope: snapshot.scope,
      activeTemplate: snapshot.activeTemplate === null ? null : { ...snapshot.activeTemplate },
      routes: snapshot.routes.map((route) => ({ ...route })),
    });
  }

  private resolveRoute(route: Route): ResolvedRoute | undefined {
    const provider = this.providers.get(route.providerId);
    const endpoint = this.endpoints.get(route.endpointId);
    const storedCredential = this.credentials.get(route.credentialId);
    const model = this.models.get(route.modelId);
    if (
      provider === undefined || !provider.enabled ||
      endpoint === undefined || !endpoint.enabled || endpoint.providerId !== provider.id ||
      storedCredential === undefined || !storedCredential.credential.enabled ||
      storedCredential.credential.providerId !== provider.id || storedCredential.credential.endpointId !== endpoint.id ||
      model === undefined || !model.enabled || model.providerId !== provider.id || model.endpointId !== endpoint.id
    ) {
      return undefined;
    }

    return {
      id: route.id,
      scope: route.scope,
      priority: route.priority,
      providerId: provider.id,
      endpointId: endpoint.id,
      modelId: model.id,
      credentialId: storedCredential.credential.id,
      providerKind: provider.kind,
      endpointUrl: endpoint.baseUrl,
      upstreamModelName: model.name,
      credentialKeyVersion: storedCredential.credential.keyVersion,
      attemptTimeoutMs: route.attemptTimeoutMs,
      maxResponseBodyBytes: route.maxResponseBodyBytes,
    };
  }

  private freezeSnapshot(snapshot: RoutingSnapshot): RoutingSnapshot {
    const frozenRoutes = snapshot.routes.map((route) => Object.freeze({ ...route }));
    const frozenTemplate = snapshot.activeTemplate === null
      ? null
      : Object.freeze({ ...snapshot.activeTemplate });
    return Object.freeze({
      revision: snapshot.revision,
      scope: snapshot.scope,
      activeTemplate: frozenTemplate,
      routes: Object.freeze(frozenRoutes),
    });
  }

  private async serializeMutation<Result>(mutation: () => Result | Promise<Result>): Promise<Result> {
    const previousMutation = this.mutationTail;
    let releaseMutation: (() => void) | undefined;
    this.mutationTail = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    await previousMutation;
    try {
      return await mutation();
    } finally {
      releaseMutation?.();
    }
  }
}
