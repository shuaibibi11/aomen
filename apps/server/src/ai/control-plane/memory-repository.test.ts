import { describe, expect, it } from "vitest";
import { MemoryLlmControlPlaneRepository } from "./memory-repository.js";
import {
  validateCredential,
  validateEndpoint,
  validateModel,
  validateProvider,
  validateRoute,
  type Endpoint,
  type Model,
  type Provider,
  type Route,
} from "./domain.js";
import { calculatePromptTemplateChecksum } from "./template.js";
import type { EffectiveMutationRequest } from "./repository.js";
import { LlmControlPlaneService } from "./service.js";

const provider: Provider = { id: "provider-1", name: "OpenAI", kind: "openai_compatible", enabled: true };
const endpoint: Endpoint = { id: "endpoint-1", providerId: provider.id, baseUrl: "https://api.openai.com/v1", enabled: true };
const model: Model = { id: "model-1", providerId: provider.id, endpointId: endpoint.id, name: "test-model", enabled: true };
const credential = { id: "credential-1", providerId: provider.id, endpointId: endpoint.id, keyVersion: 1, enabled: true };
const route: Route = { id: "route-1", scope: "player_bet", priority: 1, providerId: provider.id, endpointId: endpoint.id, credentialId: credential.id, modelId: model.id, enabled: true, attemptTimeoutMs: 1000, maxResponseBodyBytes: 4096 };

function mutationRequest(expectedRevision: number, action: string) {
  return {
    expectedRevision,
    audit: {
      actorUserId: "operator-1",
      action,
      safeMetadata: { changedFields: ["enabled"] },
    },
  };
}

async function seed(service: LlmControlPlaneService): Promise<void> {
  await service.createProvider(provider);
  await service.createEndpoint(endpoint);
  await service.createCredential(credential, { nonce: Buffer.alloc(12), ciphertext: Buffer.from("cipher"), authTag: Buffer.alloc(16) });
  await service.createModel(model);
}

describe("MemoryLlmControlPlaneRepository", () => {
  it("rejects non-boolean enabled values for every routable resource", () => {
    expect(() => validateProvider({ ...provider, enabled: "false" as never })).toThrow();
    expect(() => validateEndpoint({ ...endpoint, enabled: 1 as never })).toThrow();
    expect(() => validateCredential({ ...credential, enabled: null as never })).toThrow();
    expect(() => validateModel({ ...model, enabled: {} as never })).toThrow();
    expect(() => validateRoute({ ...route, enabled: [] as never })).toThrow();
  });

  it("enforces relationships, disabled resources, route ordering, and secret-free snapshots", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    await seed(service);
    await service.setRoute(route, mutationRequest(0, "route.created"));
    const snapshot = await service.readRoutingSnapshot("player_bet");
    expect(snapshot.routes).toEqual([
      expect.objectContaining({
        id: route.id,
        priority: route.priority,
        providerKind: provider.kind,
        endpointUrl: endpoint.baseUrl,
        upstreamModelName: model.name,
        credentialId: credential.id,
        credentialKeyVersion: credential.keyVersion,
      }),
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.routes)).toBe(true);
    expect(Object.isFrozen(snapshot.routes[0])).toBe(true);
    expect(snapshot).not.toHaveProperty("credentials");
    expect(JSON.stringify(snapshot)).not.toContain("cipher");
    await expect(service.setRoute({ ...route, priority: 1, id: "route-2" }, mutationRequest(1, "route.created"))).rejects.toThrow();
    await expect(service.setRoute({ ...route, endpointId: "unknown" }, mutationRequest(1, "route.updated"))).rejects.toThrow();
  });

  it("allows only one concurrent expected revision mutation", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    await seed(service);
    const results = await Promise.allSettled([
      service.setRoute(route, mutationRequest(0, "route.created")),
      service.setRoute({ ...route, id: "route-2", priority: 2 }, mutationRequest(0, "route.created")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps audit metadata typed and redacted", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());
    await service.createProvider(provider);
    await service.updateProvider(
      { ...provider, name: "OpenAI updated" },
      mutationRequest(0, "provider.updated"),
    );
    expect(await service.listAudit()).toHaveLength(1);
    await expect(service.updateProvider(
      { ...provider, name: "OpenAI changed" },
      {
        expectedRevision: 1,
        audit: {
          actorUserId: "operator-1",
          action: "provider.updated",
          safeMetadata: { token: "secret" } as never,
        },
      },
    )).rejects.toThrow();
  });

  it("keeps the validated audit metadata when the caller mutates it during serialization await", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    await seed(service);
    const mutableSafeMetadata = { changedFields: ["priority"] as unknown[] };
    const request = {
      expectedRevision: 0,
      audit: {
        actorUserId: "operator-1",
        action: "route.created",
        safeMetadata: mutableSafeMetadata as never,
      },
    } satisfies EffectiveMutationRequest;

    const mutationPromise = repository.applyEffectiveMutation({ kind: "route.set", route }, request);
    mutableSafeMetadata.changedFields = ["token"];
    await mutationPromise;

    await expect(repository.listAudit()).resolves.toEqual([
      expect.objectContaining({ metadata: { changedFields: ["priority"] } }),
    ]);
  });

  it("captures resource creation inputs before the serialization queue yields", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    const mutableProvider = { ...provider };
    const mutableEndpoint = { ...endpoint };
    const mutableModel = { ...model };

    const providerPromise = repository.createProvider(mutableProvider);
    mutableProvider.enabled = false;
    await providerPromise;

    const endpointPromise = repository.createEndpoint(mutableEndpoint);
    mutableEndpoint.enabled = false;
    await endpointPromise;

    const modelPromise = repository.createModel(mutableModel);
    mutableModel.enabled = false;
    await modelPromise;

    await repository.createEncryptedCredential(
      credential,
      { nonce: Buffer.alloc(12), ciphertext: Buffer.from("cipher"), authTag: Buffer.alloc(16) },
    );
    await expect(service.setRoute(route, mutationRequest(0, "route.created"))).resolves.toBe(1);
  });

  it("copies encrypted credential buffers before the serialization queue yields", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    await service.createProvider(provider);
    await service.createEndpoint(endpoint);
    const encryptedCredential = {
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.from("cipher"),
      authTag: Buffer.alloc(16),
    };

    const credentialPromise = repository.createEncryptedCredential(credential, encryptedCredential);
    encryptedCredential.ciphertext.fill(0);
    await credentialPromise;

    const storedCredential = await repository.getCredentialCiphertextForRuntime(credential.id);
    expect(storedCredential?.ciphertext.ciphertext.toString()).toBe("cipher");
  });

  it("captures effective mutation targets before the serialization queue yields", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    await seed(service);
    const mutableRoute = { ...route };

    const mutationPromise = repository.applyEffectiveMutation(
      { kind: "route.set", route: mutableRoute },
      mutationRequest(0, "route.created"),
    );
    mutableRoute.id = "mutated-route";
    await mutationPromise;

    await expect(repository.readRoutingSnapshot("player_bet")).resolves.toEqual(
      expect.objectContaining({
        routes: [expect.objectContaining({ id: route.id })],
      }),
    );
    await expect(repository.listAudit()).resolves.toEqual([
      expect.objectContaining({ targetId: route.id }),
    ]);
  });

  it("captures draft template input before the serialization queue yields", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const service = new LlmControlPlaneService(repository);
    const content = "{{publicStateJson}}";
    const mutableTemplate = {
      id: "template-1",
      key: "player_bet" as const,
      version: 1,
      status: "draft" as const,
      content,
      checksum: calculatePromptTemplateChecksum(content),
    };

    const templatePromise = repository.createDraftTemplate(mutableTemplate);
    (mutableTemplate as { status: "draft" | "active" }).status = "active";
    await templatePromise;

    await expect(service.activateTemplate("player_bet", 1, mutationRequest(0, "template.activated")))
      .resolves.toBe(1);
  });

  it("activates one immutable template per revision and preserves old snapshots", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());
    const firstContent = "{{publicStateJson}}";
    const secondContent = "{{styleInstructions}}";
    await service.createDraftTemplate({ id: "template-1", key: "player_bet", version: 1, status: "draft", content: firstContent, checksum: calculatePromptTemplateChecksum(firstContent) });
    await service.createDraftTemplate({ id: "template-2", key: "player_bet", version: 2, status: "draft", content: secondContent, checksum: calculatePromptTemplateChecksum(secondContent) });
    await service.activateTemplate("player_bet", 1, mutationRequest(0, "template.activated"));
    await service.activateTemplate("player_bet", 2, mutationRequest(1, "template.activated"));

    expect((await service.readRoutingSnapshot("player_bet", 1)).activeTemplate?.version).toBe(1);
    const activeSnapshot = await service.readRoutingSnapshot("player_bet");
    expect(activeSnapshot.activeTemplate).toEqual(expect.objectContaining({
      version: 2,
      checksum: calculatePromptTemplateChecksum(secondContent),
      content: secondContent,
    }));
    expect(Object.isFrozen(activeSnapshot.activeTemplate)).toBe(true);
  });
});
