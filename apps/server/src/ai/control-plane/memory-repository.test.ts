import { describe, expect, it } from "vitest";
import { MemoryLlmControlPlaneRepository } from "./memory-repository.js";
import type { Endpoint, Model, Provider, Route } from "./domain.js";
import { calculatePromptTemplateChecksum } from "./template.js";

const provider: Provider = { id: "provider-1", name: "OpenAI", kind: "openai_compatible", enabled: true };
const endpoint: Endpoint = { id: "endpoint-1", providerId: provider.id, baseUrl: "https://api.openai.com/v1", enabled: true };
const model: Model = { id: "model-1", providerId: provider.id, endpointId: endpoint.id, name: "test-model", enabled: true };
const credential = { id: "credential-1", providerId: provider.id, endpointId: endpoint.id, keyVersion: 1, enabled: true };
const route: Route = { id: "route-1", scope: "player_bet", priority: 1, providerId: provider.id, endpointId: endpoint.id, credentialId: credential.id, modelId: model.id, enabled: true, attemptTimeoutMs: 1000, maxResponseBodyBytes: 4096 };

async function seed(repository: MemoryLlmControlPlaneRepository): Promise<void> {
  await repository.upsertProvider(provider);
  await repository.upsertEndpoint(endpoint);
  await repository.writeEncryptedCredential(credential, { nonce: Buffer.alloc(12), ciphertext: Buffer.from("cipher"), authTag: Buffer.alloc(16) });
  await repository.upsertModel(model);
}

describe("MemoryLlmControlPlaneRepository", () => {
  it("enforces relationships, disabled resources, route ordering, and secret-free snapshots", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    await seed(repository);
    await repository.setRoute(route, 0);
    const snapshot = await repository.readRoutingSnapshot("player_bet");
    expect(snapshot.routes).toEqual([route]);
    expect(snapshot).not.toHaveProperty("credentials");
    expect(JSON.stringify(snapshot)).not.toContain("cipher");
    await expect(repository.setRoute({ ...route, priority: 1, id: "route-2" }, 1)).rejects.toThrow();
    await expect(repository.setRoute({ ...route, endpointId: "unknown" }, 1)).rejects.toThrow();
  });

  it("allows only one concurrent expected revision mutation", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    await seed(repository);
    const results = await Promise.allSettled([repository.setRoute(route, 0), repository.setRoute({ ...route, id: "route-2", priority: 2 }, 0)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps audit metadata typed and redacted", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    await repository.appendAudit({ id: "audit-1", action: "route.updated", targetId: route.id, revision: 1, actorUserId: "user-1", metadata: { changedFields: ["enabled"] } });
    expect(await repository.listAudit()).toHaveLength(1);
    await expect(repository.appendAudit({ id: "audit-2", action: "bad", targetId: "x", revision: 1, actorUserId: "u", metadata: { token: "secret" } as never })).rejects.toThrow();
  });

  it("activates one immutable template per revision and preserves old snapshots", async () => {
    const repository = new MemoryLlmControlPlaneRepository();
    const firstContent = "{{publicStateJson}}";
    const secondContent = "{{styleInstructions}}";
    await repository.saveDraftTemplate({ id: "template-1", key: "player_bet", version: 1, status: "draft", content: firstContent, checksum: calculatePromptTemplateChecksum(firstContent) });
    await repository.saveDraftTemplate({ id: "template-2", key: "player_bet", version: 2, status: "draft", content: secondContent, checksum: calculatePromptTemplateChecksum(secondContent) });
    await repository.activateTemplate("player_bet", 1, 0);
    await repository.activateTemplate("player_bet", 2, 1);

    expect((await repository.readRoutingSnapshot("player_bet", 1)).activeTemplate?.version).toBe(1);
    expect((await repository.readRoutingSnapshot("player_bet")).activeTemplate?.version).toBe(2);
  });
});
