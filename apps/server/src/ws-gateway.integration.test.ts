import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
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
const runningSchedulers: AutomaticRoundScheduler[] = [];

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
  description: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

function waitForSocketClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", resolve);
    socket.once("error", () => undefined);
  });
}

async function verifyConnectionRefused(
  url: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const socket = new WebSocket(url);
  let connectionOpened = false;
  socket.once("open", () => {
    connectionOpened = true;
    socket.terminate();
  });

  try {
    await withTimeout(
      waitForSocketClose(socket),
      timeoutMilliseconds,
      "connection refusal",
    );
    if (connectionOpened) {
      throw new Error("WebSocket connection unexpectedly opened");
    }
  } finally {
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.terminate();
    }
  }
}

afterEach(async () => {
  for (const scheduler of runningSchedulers.splice(0)) {
    scheduler.stop();
  }
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
  const store = new MemoryEventStore();
  const roomManager = new RoomManager(store);
  const gateway = new WsGateway({ port: 0, roomManager });
  openGateways.push(gateway);
  await gateway.waitUntilListening();
  return {
    gateway,
    roomManager,
    store,
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
  it("replays an executed request across reconnects without submitting or broadcasting again", async () => {
    const { roomManager, store, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "reconnect-idempotency");
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const firstClient = await connect(url);
    const observerClient = await connect(url);
    await Promise.all([join(firstClient, room), join(observerClient, room)]);
    const request = {
      type: "submit_intent",
      requestId: "stable-request",
      intent: {
        type: "place_bet",
        actorId: room.getSnapshot().seats[0]!.occupantId,
        seatId: room.getHumanSeatId(),
        betKind: "player",
        amount: 100,
      },
    };
    const eventCountBefore = store.count();

    firstClient.send(request);
    const originalResult = await firstClient.waitForMessage(
      (message) => message.type === "intent_result",
    );
    await waitForUpdate(observerClient);
    expect(store.count()).toBe(eventCountBefore + 1);
    await firstClient.close();

    const reconnectedClient = await connect(url);
    await join(reconnectedClient, room);
    reconnectedClient.send(request);

    expect(await reconnectedClient.waitForMessage(
      (message) => message.type === "intent_result",
    )).toEqual(originalResult);
    expect(store.count()).toBe(eventCountBefore + 1);
    await expect(observerClient.waitForMessage(
      (message) => message.type === "event" || message.type === "snapshot",
      50,
    )).rejects.toThrow(/timed out/i);
  });

  it("rejects a reused request identifier carrying a different intent", async () => {
    const { roomManager, store, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "request-conflict");
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const client = await connect(url);
    await join(client, room);
    const actorId = room.getSnapshot().seats[0]!.occupantId;
    const baseRequest = {
      type: "submit_intent",
      requestId: "conflicting-request",
      intent: {
        type: "place_bet",
        actorId,
        seatId: room.getHumanSeatId(),
        betKind: "player",
        amount: 100,
      },
    };
    client.send(baseRequest);
    await client.waitForMessage((message) => message.type === "intent_result");
    const eventCountAfterOriginal = store.count();

    client.send({
      ...baseRequest,
      intent: { ...baseRequest.intent, amount: 200 },
    });

    expect(await client.waitForMessage((message) => message.type === "error"))
      .toMatchObject({
        type: "error",
        code: "request_id_conflict",
        requestId: "conflicting-request",
      });
    expect(store.count()).toBe(eventCountAfterOriginal);
  });

  it("evicts the oldest request after 1024 requests for one table and actor", async () => {
    const { roomManager, store, url } = await createSelfHostedGateway();
    const room = createRoom(roomManager, "request-eviction");
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const client = await connect(url);
    await join(client, room);
    const actorId = room.getSnapshot().seats[0]!.occupantId;
    const buildRequest = (requestId: string) => ({
      type: "submit_intent",
      requestId,
      intent: {
        type: "place_bet",
        actorId,
        seatId: room.getHumanSeatId(),
        betKind: "player",
        amount: 100,
      },
    });

    for (let requestIndex = 0; requestIndex < 1_025; requestIndex += 1) {
      client.send(buildRequest(`bounded-${requestIndex}`));
      await client.waitForMessage(
        (message) => message.type === "intent_result" && message.requestId === `bounded-${requestIndex}`,
      );
    }
    const eventCountBeforeEvictedRetry = store.count();
    client.send(buildRequest("bounded-0"));

    await client.waitForMessage(
      (message) => message.type === "intent_result" && message.requestId === "bounded-0",
    );
    expect(store.count()).toBe(eventCountBeforeEvictedRetry + 1);
  }, 20_000);

  it("isolates identical request identifiers between tables and actors", async () => {
    const { roomManager, url } = await createSelfHostedGateway();
    const firstRoom = createRoom(roomManager, "request-scope-first");
    const secondRoom = createRoom(roomManager, "request-scope-second");
    firstRoom.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    secondRoom.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const firstClient = await connect(url);
    const secondClient = await connect(url);
    await Promise.all([join(firstClient, firstRoom), join(secondClient, secondRoom)]);
    for (const [client, room] of [[firstClient, firstRoom], [secondClient, secondRoom]] as const) {
      client.send({
        type: "submit_intent",
        requestId: "shared-request-id",
        intent: {
          type: "place_bet",
          actorId: room.getSnapshot().seats[0]!.occupantId,
          seatId: room.getHumanSeatId(),
          betKind: "player",
          amount: 100,
        },
      });
    }

    const results = await Promise.all([
      firstClient.waitForMessage((message) => message.type === "intent_result"),
      secondClient.waitForMessage((message) => message.type === "intent_result"),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((message) => message.type === "intent_result")).toBe(true);
  });

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
      requestId: "unjoined-request",
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
    runningSchedulers.push(scheduler);

    scheduler.start();
    const lifecycleIntentTypes = new Set<string>();
    while (!lifecycleIntentTypes.has("settle_round")) {
      const { eventMessage } = await waitForUpdate(client);
      if (eventMessage.event.intent !== undefined) {
        lifecycleIntentTypes.add(eventMessage.event.intent.type);
      }
    }
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

  it("immediately closes a connection admitted after shutdown starts", async () => {
    const roomManager = new RoomManager(new MemoryEventStore());
    const webSocketServer = new WebSocketServer({ noServer: true });
    const gateway = new WsGateway({ roomManager, webSocketServer });
    openGateways.push(gateway);
    let handleSocketClose: (() => void) | undefined;
    const racingSocket = {
      on: vi.fn(),
      once: vi.fn((eventName: string, listener: () => void) => {
        if (eventName === "close") {
          handleSocketClose = listener;
        }
      }),
      readyState: WebSocket.OPEN,
      terminate: vi.fn(() => handleSocketClose?.()),
    } as unknown as WebSocket;

    const closePromise = gateway.close();
    webSocketServer.emit("connection", racingSocket, {});
    await closePromise;

    expect(racingSocket.terminate).toHaveBeenCalledOnce();
    expect(racingSocket.on).not.toHaveBeenCalled();
  });

  it("rejects a connection racing with shutdown and closes within a bounded time", async () => {
    let allowUpgrade!: () => void;
    let signalUpgradePending!: () => void;
    const upgradePending = new Promise<void>((resolve) => {
      signalUpgradePending = resolve;
    });
    const webSocketServer = new WebSocketServer({
      port: 0,
      verifyClient: (_info, completeVerification) => {
        allowUpgrade = () => completeVerification(true);
        signalUpgradePending();
      },
    });
    const gateway = new WsGateway({
      roomManager: new RoomManager(new MemoryEventStore()),
      webSocketServer,
    });
    openGateways.push(gateway);
    await gateway.waitUntilListening();
    const url = `ws://127.0.0.1:${gateway.getPort()}`;
    const racingSocket = new WebSocket(url);

    try {
      await withTimeout(upgradePending, 1_000, "racing upgrade admission");
      const closePromise = gateway.close();
      allowUpgrade();

      await withTimeout(closePromise, 1_000, "gateway shutdown");
      await withTimeout(waitForSocketClose(racingSocket), 1_000, "racing socket close");

      expect(racingSocket.readyState).toBe(WebSocket.CLOSED);
      await verifyConnectionRefused(url, 1_000);
    } finally {
      if (racingSocket.readyState !== WebSocket.CLOSED) {
        racingSocket.terminate();
      }
      await gateway.close();
    }
  });
});
