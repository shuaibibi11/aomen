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

  async upsertProvider(provider: Provider): Promise<void> {
    validateProvider(provider);
    await this.serializeMutation(() => {
      this.providers.set(provider.id, { ...provider });
    });
  }

  async upsertEndpoint(endpoint: Endpoint): Promise<void> {
    validateEndpoint(endpoint);
    const normalizedEndpoint: Endpoint = {
      ...endpoint,
      baseUrl: this.endpointPolicy.normalizeEndpoint(endpoint.baseUrl),
    };
    await this.serializeMutation(() => {
      const provider = this.providers.get(normalizedEndpoint.providerId);
      if (provider === undefined) {
        throw new Error("endpoint provider does not exist");
      }
      this.endpoints.set(normalizedEndpoint.id, normalizedEndpoint);
    });
  }

  async writeEncryptedCredential(
    credential: Credential,
    ciphertext: CredentialCiphertext,
  ): Promise<void> {
    validateCredential(credential);
    if (ciphertext.nonce.length !== 12 || ciphertext.authTag.length !== 16 || ciphertext.ciphertext.length === 0) {
      throw new Error("encrypted credential payload is invalid");
    }
    await this.serializeMutation(() => {
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

  async upsertModel(model: Model): Promise<void> {
    validateModel(model);
    await this.serializeMutation(() => {
      const endpoint = this.endpoints.get(model.endpointId);
      if (endpoint === undefined || endpoint.providerId !== model.providerId) {
        throw new Error("model endpoint and provider relationship is invalid");
      }
      this.models.set(model.id, { ...model });
    });
  }

  async setRoute(route: Route, expectedRevision: number): Promise<number> {
    validateRoute(route);
    return this.serializeMutation(() => {
      this.requireExpectedRevision(expectedRevision);
      this.validateRouteRelationships(route);
      for (const existingRoute of this.routes.values()) {
        if (
          existingRoute.id !== route.id &&
          existingRoute.scope === route.scope &&
          existingRoute.priority === route.priority
        ) {
          throw new Error("route scope and priority must be unique");
        }
      }
      this.routes.set(route.id, { ...route });
      return this.advanceRevision();
    });
  }

  async saveDraftTemplate(template: PromptTemplateVersion): Promise<void> {
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

  async activateTemplate(
    key: PromptTemplateVersion["key"],
    version: number,
    expectedRevision: number,
  ): Promise<number> {
    if (key !== "player_bet" || !Number.isSafeInteger(version) || version <= 0) {
      throw new Error("prompt template activation request is invalid");
    }
    return this.serializeMutation(() => {
      this.requireExpectedRevision(expectedRevision);
      const template = this.templates.get(version);
      if (template === undefined || template.key !== key || template.status !== "draft") {
        throw new Error("draft prompt template version does not exist");
      }
      for (const [existingVersion, existingTemplate] of this.templates) {
        if (existingTemplate.key === key && existingTemplate.status === "active") {
          this.templates.set(existingVersion, { ...existingTemplate, status: "archived" });
        }
      }
      this.templates.set(version, { ...template, status: "active" });
      return this.advanceRevision();
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

  async appendAudit(auditRecord: AuditRecord): Promise<void> {
    validateAuditRecord(auditRecord);
    await this.serializeMutation(() => {
      if (this.auditRecords.some((existingAudit) => existingAudit.id === auditRecord.id)) {
        throw new Error("audit record already exists");
      }
      this.auditRecords.push(cloneAuditRecord(auditRecord));
    });
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

  private advanceRevision(): number {
    this.currentRevision += 1;
    this.storeSnapshot();
    return this.currentRevision;
  }

  private storeSnapshot(): void {
    const activeTemplate = [...this.templates.values()].find((template) => template.status === "active");
    const routes = [...this.routes.values()]
      .filter((route) => route.scope === "player_bet" && route.enabled)
      .sort((firstRoute, secondRoute) => firstRoute.priority - secondRoute.priority)
      .map((route) => ({ ...route }));
    this.snapshots.set(this.currentRevision, {
      revision: this.currentRevision,
      scope: "player_bet",
      ...(activeTemplate === undefined ? {} : { activeTemplate: { ...activeTemplate } }),
      routes,
    });
  }

  private cloneSnapshot(snapshot: RoutingSnapshot): RoutingSnapshot {
    return {
      revision: snapshot.revision,
      scope: snapshot.scope,
      ...(snapshot.activeTemplate === undefined ? {} : { activeTemplate: { ...snapshot.activeTemplate } }),
      routes: snapshot.routes.map((route) => ({ ...route })),
    };
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
