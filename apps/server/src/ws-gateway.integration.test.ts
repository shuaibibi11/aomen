import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { RulePack } from "@mct/rule-packs";
import type { ServerMessage } from "@mct/room-protocol";
import { asActorId, asTableId, SYSTEM_DEALER } from "@mct/shared";
import { AutomaticRoundScheduler } from "./automatic-round-scheduler.js";
import { MemoryEventStore } from "./memory-event-store.js";
import { RoomManager, type Room } from "./room-manager.js";
import { WebSocketTestClient } from "./test/websocket-test-client.js";
import { WsGateway } from "./ws-gateway.js";

const JOIN_CREDENTIAL = "integration-credential";
const openClients: WebSocketTestClient[] = [];
const openGateways: WsGateway[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openGateways.splice(0).map((gateway) => gateway.close()));
});

function createRulePack(): RulePack {
  return {
    id: "std",
    version: "1.0.0",
    displayName: "Standard",
    variant: "standard",
    limits: { min: 100, max: 100000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [
      { kind: "player_pair", payout: 11 },
      { kind: "banker_pair", payout: 11 },
    ],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  };
}

function createRoom(roomManager: RoomManager, name: string): Room {
  return roomManager.createRoom({
    tableId: asTableId(name),
    rulePack: createRulePack(),
    humanActorId: asActorId(`${name}-human`),
    joinCredential: JOIN_CREDENTIAL,
    seatCount: 2,
    aiCount: 0,
    shoeSeed: `${name}-seed`,
  });
}

async function createSelfHostedGateway() {
  const roomManager = new RoomManager(new MemoryEventStore());
  const gateway = new WsGateway({ port: 0, roomManager });
  openGateways.push(gateway);
  await gateway.waitUntilListening();
  return {
    gateway,
    roomManager,
    url: `ws://127.0.0.1:${gateway.getPort()}`,
  };
}

async function connect(url: string): Promise<WebSocketTestClient> {
  const client = await WebSocketTestClient.connect(url);
  openClients.push(client);
  return client;
}

async function join(
  client: WebSocketTestClient,
  room: Room,
): Promise<ServerMessage> {
  const snapshot = room.getSnapshot();
  client.send({
    type: "join_room",
    tableId: snapshot.tableId,
    actorId: snapshot.seats[0]?.occupantId,
    credential: JOIN_CREDENTIAL,
  });
  return client.waitForMessage(
    (message) => message.type === "joined" || message.type === "error",
  );
}

async function waitForUpdate(client: WebSocketTestClient) {
  const eventMessage = await client.waitForMessage(
    (message) => message.type === "event",
  );
  const snapshotMessage = await client.waitForMessage(
    (message) => message.type === "snapshot",
  );
  if (eventMessage.type !== "event" || snapshotMessage.type !== "snapshot") {
    throw new Error("Expected an event and snapshot update pair");
  }
  expect(eventMessage.event.seq).toBe(snapshotMessage.snapshot.lastEventSeq);
  return { eventMessage, snapshotMessage };
}

describe("WsGateway real WebSocket integration", () => {
  it("self-hosts on an ephemeral port and reports its listening lifecycle", async () => {
    const roomManager = new RoomManager(new MemoryEventStore());
    const gateway = new WsGateway({ port: 0, roomManager });
    openGateways.push(gateway);

    await gateway.waitUntilListening();
    expect(gateway.getPort()).toBeGreaterThan(0);
  });

  it("reports a clear error before an injected server is listening", async () => {
    const roomManager = new RoomManager(new MemoryEventStore());
    const webSocketServer = new WebSocketServer({ noServer: true });
    const gateway = new WsGateway({ roomManager, webSocketServer });
    openGateways.push(gateway);

    expect(() => gateway.getPort()).toThrow("WebSocket server is not listening");
    await gateway.close();
  });

  it("keeps injected WebSocketServer mode available", async () => {
    const roomManager = new RoomManager(new MemoryEventStore());
    const webSocketServer = new WebSocketServer({ port: 0 });
    const gateway = new WsGateway({ roomManager, webSocketServer });
    openGateways.push(gateway);

    await gateway.waitUntilListening();
    expect(gateway.getPort()).toBeGreaterThan(0);
  });

  it("covers joined, unknown room, not joined, malformed JSON, and ping/pong", async () => {
    const { roomManager, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "matrix-room");
    const joinedClient = await connect(url);
    expect(await join(joinedClient, room)).toMatchObject({ type: "joined" });

    const unknownRoomClient = await connect(url);
    unknownRoomClient.send({
      type: "join_room",
      tableId: "missing-room",
      actorId: "missing-human",
      credential: JOIN_CREDENTIAL,
    });
    expect(await unknownRoomClient.waitForMessage((message) => message.type === "error"))
      .toMatchObject({ type: "error", code: "unknown_room" });

    const unjoinedClient = await connect(url);
    unjoinedClient.send({
      type: "submit_intent",
      intent: { type: "start_round", actorId: "some-actor" },
    });
    expect(await unjoinedClient.waitForMessage((message) => message.type === "error"))
      .toMatchObject({ type: "error", code: "not_joined" });

    unjoinedClient.sendRaw("not-json");
    expect(await unjoinedClient.waitForMessage((message) => message.type === "error"))
      .toMatchObject({ type: "error", code: "malformed_message" });

    unjoinedClient.send({ type: "ping", nonce: 42 });
    expect(await unjoinedClient.waitForMessage((message) => message.type === "pong"))
      .toEqual({ type: "pong", nonce: 42 });
  });

  it("broadcasts aligned event and snapshot pairs to both clients in one room", async () => {
    const { roomManager, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "shared-room");
    const firstClient = await connect(url);
    const secondClient = await connect(url);
    await Promise.all([join(firstClient, room), join(secondClient, room)]);

    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const [firstUpdate, secondUpdate] = await Promise.all([
      waitForUpdate(firstClient),
      waitForUpdate(secondClient),
    ]);

    expect(firstUpdate.eventMessage.event.seq).toBe(
      secondUpdate.eventMessage.event.seq,
    );
    expect(firstUpdate.snapshotMessage.snapshot).toEqual(
      secondUpdate.snapshotMessage.snapshot,
    );
  });

  it("isolates broadcasts between rooms", async () => {
    const { roomManager, url } = await createSelfHostedGateway();
    const firstRoom = createRoom(roomManager, "isolated-first");
    const secondRoom = createRoom(roomManager, "isolated-second");
    const firstClient = await connect(url);
    const secondClient = await connect(url);
    await Promise.all([join(firstClient, firstRoom), join(secondClient, secondRoom)]);

    firstRoom.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    await waitForUpdate(firstClient);
    await expect(
      secondClient.waitForMessage(
        (message) => message.type === "event" || message.type === "snapshot",
        50,
      ),
    ).rejects.toThrow(/timed out/i);
  });

  it("broadcasts scheduler lifecycle without client intent submissions", async () => {
    const { roomManager, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "scheduled-room");
    const client = await connect(url);
    await join(client, room);
    const scheduler = new AutomaticRoundScheduler(room, {
      bettingWindowMs: 5,
      cardDealIntervalMs: 1,
      settlementDisplayMs: 0,
      interRoundDelayMs: 1_000,
    });

    scheduler.start();
    const lifecycleIntentTypes = new Set<string>();
    while (!lifecycleIntentTypes.has("settle_round")) {
      const { eventMessage } = await waitForUpdate(client);
      if (eventMessage.event.intent !== undefined) {
        lifecycleIntentTypes.add(eventMessage.event.intent.type);
      }
    }
    scheduler.stop();

    expect(lifecycleIntentTypes).toEqual(
      new Set(["start_round", "no_more_bets", "deal_next", "settle_round"]),
    );
  });

  it("unsubscribes after the final client disconnects", async () => {
    const { roomManager, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "disconnect-room");
    const originalSubscribe = roomManager.subscribe.bind(roomManager);
    let resolveUnsubscribed!: () => void;
    const unsubscribed = new Promise<void>((resolve) => {
      resolveUnsubscribed = resolve;
    });
    const unsubscribe = vi.fn(resolveUnsubscribed);
    vi.spyOn(roomManager, "subscribe").mockImplementation((tableId, listener) => {
      const originalUnsubscribe = originalSubscribe(tableId, listener);
      return () => {
        unsubscribe();
        originalUnsubscribe();
      };
    });
    const client = await connect(url);
    await join(client, room);

    await client.close();
    await unsubscribed;

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("awaits socket and server shutdown and is safe to close repeatedly", async () => {
    const { gateway, roomManager, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "close-room");
    const client = await connect(url);
    await join(client, room);

    await Promise.all([gateway.close(), gateway.close()]);
    await client.close();
    await gateway.close();

    expect(() => gateway.getPort()).toThrow(/not listening/i);
    await expect(WebSocketTestClient.connect(url)).rejects.toThrow();
  });
});
