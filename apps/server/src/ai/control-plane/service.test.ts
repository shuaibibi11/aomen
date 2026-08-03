import { describe, expect, it } from "vitest";
import type { Credential, Endpoint, Model, Provider, Route } from "./domain.js";
import { MemoryLlmControlPlaneRepository } from "./memory-repository.js";
import { LlmControlPlaneService } from "./service.js";

const provider: Provider = {
  id: "provider-1",
  name: "OpenAI",
  kind: "openai_compatible",
  enabled: true,
};
const endpoint: Endpoint = {
  id: "endpoint-1",
  providerId: provider.id,
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
};
const credential: Credential = {
  id: "credential-1",
  providerId: provider.id,
  endpointId: endpoint.id,
  keyVersion: 1,
  enabled: true,
};
const model: Model = {
  id: "model-1",
  providerId: provider.id,
  endpointId: endpoint.id,
  name: "gpt-test",
  enabled: true,
};
const route: Route = {
  id: "route-1",
  scope: "player_bet",
  priority: 1,
  providerId: provider.id,
  endpointId: endpoint.id,
  credentialId: credential.id,
  modelId: model.id,
  enabled: true,
  attemptTimeoutMs: 1000,
  maxResponseBodyBytes: 4096,
};

function audit(action: string, changedFields: readonly string[]) {
  return {
    actorUserId: "operator-1",
    action,
    safeMetadata: { changedFields },
  };
}

async function createUnreferencedResources(service: LlmControlPlaneService): Promise<void> {
  await service.createProvider(provider);
  await service.createEndpoint(endpoint);
  await service.createCredential(credential, {
    nonce: Buffer.alloc(12),
    ciphertext: Buffer.from("ciphertext"),
    authTag: Buffer.alloc(16),
  });
  await service.createModel(model);
}

describe("LlmControlPlaneService", () => {
  it("keeps unreferenced resource creation at revision zero", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());

    await createUnreferencedResources(service);

    expect(await service.readRoutingSnapshot("player_bet")).toEqual({
      revision: 0,
      scope: "player_bet",
      activeTemplate: null,
      routes: [],
    });
    expect(await service.listAudit()).toEqual([]);
  });

  it("records each effective route and source update with its revision", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());
    await createUnreferencedResources(service);

    await service.setRoute(route, { expectedRevision: 0, audit: audit("route.created", ["priority"]) });
    await service.updateEndpoint(
      { ...endpoint, baseUrl: "https://api.openai.com/v2" },
      { expectedRevision: 1, audit: audit("endpoint.updated", ["baseUrl"]) },
    );
    await service.updateModel(
      { ...model, name: "gpt-test-v2" },
      { expectedRevision: 2, audit: audit("model.updated", ["name"]) },
    );
    await service.setCredentialEnabled(
      credential.id,
      false,
      { expectedRevision: 3, audit: audit("credential.disabled", ["enabled"]) },
    );

    expect(await service.readRoutingSnapshot("player_bet")).toEqual({
      revision: 4,
      scope: "player_bet",
      activeTemplate: null,
      routes: [],
    });
    expect(await service.listAudit()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "route.created", revision: 1, actorUserId: "operator-1" }),
      expect.objectContaining({ action: "endpoint.updated", revision: 2, actorUserId: "operator-1" }),
      expect.objectContaining({ action: "model.updated", revision: 3, actorUserId: "operator-1" }),
      expect.objectContaining({ action: "credential.disabled", revision: 4, actorUserId: "operator-1" }),
    ]));
  });

  it("preserves a deeply immutable resolved snapshot after source changes and disablement", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());
    await createUnreferencedResources(service);
    await service.setRoute(route, { expectedRevision: 0, audit: audit("route.created", ["priority"]) });
    const capturedSnapshot = await service.readRoutingSnapshot("player_bet");

    await service.updateEndpoint(
      { ...endpoint, baseUrl: "https://api.openai.com/v2" },
      { expectedRevision: 1, audit: audit("endpoint.updated", ["baseUrl"]) },
    );
    await service.updateProvider(
      { ...provider, enabled: false },
      { expectedRevision: 2, audit: audit("provider.disabled", ["enabled"]) },
    );

    expect(capturedSnapshot.routes[0]).toEqual(expect.objectContaining({
      providerKind: "openai_compatible",
      endpointUrl: "https://api.openai.com/v1",
      upstreamModelName: "gpt-test",
      credentialId: "credential-1",
      credentialKeyVersion: 1,
    }));
    expect(await service.readRoutingSnapshot("player_bet")).toEqual({
      revision: 3,
      scope: "player_bet",
      activeTemplate: null,
      routes: [],
    });
    expect(Object.isFrozen(capturedSnapshot)).toBe(true);
    expect(Object.isFrozen(capturedSnapshot.routes)).toBe(true);
    expect(Object.isFrozen(capturedSnapshot.routes[0])).toBe(true);
  });

  it("uses a new credential identifier when a route switches key versions", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());
    await createUnreferencedResources(service);
    await service.setRoute(route, { expectedRevision: 0, audit: audit("route.created", ["priority"]) });
    const firstSnapshot = await service.readRoutingSnapshot("player_bet");

    await expect(service.createCredential({ ...credential, keyVersion: 2 }, {
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.from("replacement-ciphertext"),
      authTag: Buffer.alloc(16),
    })).rejects.toThrow("credential identifier is immutable");

    const replacementCredential: Credential = {
      ...credential,
      id: "credential-2",
      keyVersion: 2,
    };
    await service.createCredential(replacementCredential, {
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.from("replacement-ciphertext"),
      authTag: Buffer.alloc(16),
    });
    await service.setRoute(
      { ...route, credentialId: replacementCredential.id },
      { expectedRevision: 1, audit: audit("route.credential_switched", ["credentialId"]) },
    );

    expect(firstSnapshot.routes[0]).toEqual(expect.objectContaining({
      credentialId: credential.id,
      credentialKeyVersion: 1,
    }));
    expect((await service.readRoutingSnapshot("player_bet")).routes[0]).toEqual(expect.objectContaining({
      credentialId: replacementCredential.id,
      credentialKeyVersion: 2,
    }));
  });

  it("rejects stale revisions and secret-bearing audit metadata", async () => {
    const service = new LlmControlPlaneService(new MemoryLlmControlPlaneRepository());
    await createUnreferencedResources(service);
    await service.setRoute(route, { expectedRevision: 0, audit: audit("route.created", ["priority"]) });

    await expect(service.updateProvider(
      { ...provider, enabled: false },
      { expectedRevision: 0, audit: audit("provider.disabled", ["enabled"]) },
    )).rejects.toThrow("LLM routing revision conflict");
    await expect(service.updateProvider(
      { ...provider, enabled: false },
      {
        expectedRevision: 1,
        audit: {
          actorUserId: "operator-1",
          action: "provider.disabled",
          safeMetadata: { token: "do-not-store" } as never,
        },
      },
    )).rejects.toThrow("audit metadata contains a forbidden key");
  });
});
