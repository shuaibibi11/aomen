import { afterEach, describe, expect, it } from "vitest";
import {
  createTestServerTransport,
  MemoryEventStore,
  RoomManager,
  WsGateway,
} from "./testing.js";

const openTestServers: Array<{ readonly close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(openTestServers.splice(0).map((testServer) => testServer.close()));
});

describe("server testing exports", () => {
  it("constructs a noServer gateway behind the shared test transport", async () => {
    const testServer = await createTestServerTransport({
      roomManager: new RoomManager(new MemoryEventStore()),
    });
    openTestServers.push(testServer);

    expect(testServer.gateway).toBeInstanceOf(WsGateway);
    expect(testServer.transport.getPort()).toBe(testServer.port);
    expect(testServer.port).toBeGreaterThan(0);
    await expect(testServer.close()).resolves.toBeUndefined();
  });
});
