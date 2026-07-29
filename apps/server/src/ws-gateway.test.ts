import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { RulePack } from "@mct/rule-packs";
import type { ServerMessage } from "@mct/room-protocol";
import {
  asActorId,
  asTableId,
  SYSTEM_DEALER,
  type TableEvent,
  type TableId,
} from "@mct/shared";
import type { EventStore } from "./memory-event-store.js";
import { RoomFaultedError, RoomManager } from "./room-manager.js";
import { getIntentActorError, WsGateway } from "./ws-gateway.js";

const openGateways: WsGateway[] = [];
const JOIN_CREDENTIAL = "gateway-test-credential";

afterEach(async () => {
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

class ControllableEventStore implements EventStore {
  readonly events: TableEvent[] = [];
  shouldFailAppend = false;

  append(event: TableEvent): void {
    if (this.shouldFailAppend) {
      throw new Error("sensitive database detail");
    }
    this.events.push(event);
  }

  listByTable(tableId: TableId): readonly TableEvent[] {
    return this.events.filter((event) => event.tableId === tableId);
  }

  count(): number {
    return this.events.length;
  }
}

async function createGateway(onError?: (error: unknown) => void) {
  const tableId = asTableId("gateway-table");
  const humanActorId = asActorId("gateway-human");
  const store = new ControllableEventStore();
  const roomManager = new RoomManager(store);
  const room = roomManager.createRoom({
    tableId,
    rulePack: createRulePack(),
    humanActorId,
    joinCredential: JOIN_CREDENTIAL,
    seatCount: 2,
    aiCount: 1,
    shoeSeed: "gateway-seed",
  });
  const webSocketServer = new WebSocketServer({ port: 0 });
  const gateway = new WsGateway({ roomManager, webSocketServer, onError });
  openGateways.push(gateway);
  if (webSocketServer.address() === null) {
    await once(webSocketServer, "listening");
  }
  const address = webSocketServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP WebSocket address");
  }
  return {
    gateway,
    humanActorId,
    room,
    store,
    tableId,
    url: `ws://127.0.0.1:${address.port}`,
    webSocketServer,
  };
}

async function connectClient(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await once(socket, "open");
  return socket;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", handleMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2000);
    const handleMessage = (raw: WebSocket.RawData): void => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", handleMessage);
      resolve(message);
    };
    socket.on("message", handleMessage);
  });
}

async function joinClient(
  socket: WebSocket,
  tableId: TableId,
  actorId: ReturnType<typeof asActorId>,
  credential = JOIN_CREDENTIAL,
): Promise<ServerMessage> {
  const response = waitForMessage(
    socket,
    (message) => message.type === "joined" || message.type === "error",
  );
  socket.send(JSON.stringify({ type: "join_room", tableId, actorId, credential }));
  return response;
}

describe("WebSocket actor binding", () => {
  const joinedActorId = asActorId("joined-human");

  it("accepts an intent from the actor bound at join", () => {
    expect(
      getIntentActorError(joinedActorId, {
        type: "start_round",
        actorId: joinedActorId,
      }),
    ).toBeNull();
  });

  it("rejects an intent carrying another actor identity", () => {
    expect(
      getIntentActorError(joinedActorId, {
        type: "start_round",
        actorId: asActorId("different-human"),
      }),
    ).toBe("actor_mismatch");
  });

  it("rejects system dealer intents from ordinary sockets", () => {
    expect(
      getIntentActorError(joinedActorId, {
        type: "start_round",
        actorId: SYSTEM_DEALER,
      }),
    ).toBe("actor_mismatch");
  });
});

describe("WsGateway room delivery", () => {
  it("rejects the correct actor with a wrong credential without leaking it", async () => {
    const { humanActorId, room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    const snapshotBefore = room.getSnapshot();
    const eventCountBefore = store.count();
    const wrongCredential = "credential-that-must-not-leak";

    const response = await joinClient(socket, tableId, humanActorId, wrongCredential);

    expect(response).toMatchObject({ type: "error", code: "actor_not_allowed" });
    expect(JSON.stringify(response)).not.toContain(wrongCredential);
    expect(room.getSnapshot()).toEqual(snapshotBefore);
    expect(store.count()).toBe(eventCountBefore);

    const pongResponse = waitForMessage(socket, (message) => message.type === "pong");
    socket.send(JSON.stringify({ type: "ping", nonce: 7 }));
    expect(await pongResponse).toEqual({ type: "pong", nonce: 7 });
    socket.close();
  });

  it("rejects a wrong actor with the correct credential", async () => {
    const { room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    const snapshotBefore = room.getSnapshot();
    const eventCountBefore = store.count();

    const response = await joinClient(socket, tableId, asActorId("wrong-actor"));

    expect(response).toMatchObject({ type: "error", code: "actor_not_allowed" });
    expect(room.getSnapshot()).toEqual(snapshotBefore);
    expect(store.count()).toBe(eventCountBefore);
    socket.close();
  });

  it("rejects arbitrary, AI, and system actor identities at join", async () => {
    const { room, tableId, url } = await createGateway();
    const aiActorId = room
      .getSnapshot()
      .seats.map((seat) => seat.occupantId)
      .find((actorId) => actorId !== null && actorId !== asActorId("gateway-human"));
    expect(aiActorId).toBeDefined();

    for (const actorId of [asActorId("intruder"), aiActorId!, SYSTEM_DEALER]) {
      const socket = await connectClient(url);
      const response = await joinClient(socket, tableId, actorId);

      expect(response).toMatchObject({
        type: "error",
        code: "actor_not_allowed",
      });
      socket.close();
    }
  });

  it("allows multiple connections for the same authorized human actor", async () => {
    const { humanActorId, tableId, url } = await createGateway();
    const firstSocket = await connectClient(url);
    const secondSocket = await connectClient(url);

    const [firstJoin, secondJoin] = await Promise.all([
      joinClient(firstSocket, tableId, humanActorId),
      joinClient(secondSocket, tableId, humanActorId),
    ]);

    expect(firstJoin).toMatchObject({ type: "joined", actorId: humanActorId });
    expect(secondJoin).toMatchObject({ type: "joined", actorId: humanActorId });
    firstSocket.close();
    secondSocket.close();
  });

  it("sends authoritative rule and seat bootstrap descriptors", async () => {
    const { humanActorId, room, tableId, url } = await createGateway();
    const socket = await connectClient(url);

    const joined = await joinClient(socket, tableId, humanActorId);

    expect(joined).toMatchObject({
      type: "joined",
      rulePack: createRulePack(),
      seats: room.getSeatDescriptors(),
    });
    socket.close();
  });

  it.each([
    ["missing intent", { type: "submit_intent" }],
    ["unknown bet kind", { type: "submit_intent", intent: { type: "place_bet", actorId: "gateway-human", seatId: "gateway-table-seat-1", betKind: "dragon", amount: 100 } }],
    ["non-number amount", { type: "submit_intent", intent: { type: "place_bet", actorId: "gateway-human", seatId: "gateway-table-seat-1", betKind: "player", amount: "100" } }],
    ["serialized NaN amount", { type: "submit_intent", intent: { type: "place_bet", actorId: "gateway-human", seatId: "gateway-table-seat-1", betKind: "player", amount: Number.NaN } }],
    ["empty actor id", { type: "submit_intent", intent: { type: "clear_bets", actorId: "", seatId: "gateway-table-seat-1" } }],
    ["empty seat id", { type: "submit_intent", intent: { type: "clear_bets", actorId: "gateway-human", seatId: "" } }],
  ])("rejects malformed %s and remains alive", async (_caseName, malformedMessage) => {
    const { humanActorId, room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    await joinClient(socket, tableId, humanActorId);
    const snapshotBefore = room.getSnapshot();
    const eventCountBefore = store.count();
    const malformedResponse = waitForMessage(socket, (message) => message.type === "error");

    socket.send(JSON.stringify(malformedMessage));

    expect(await malformedResponse).toMatchObject({
      type: "error",
      code: "malformed_message",
    });
    expect(room.getSnapshot()).toEqual(snapshotBefore);
    expect(store.count()).toBe(eventCountBefore);

    const pongResponse = waitForMessage(socket, (message) => message.type === "pong");
    socket.send(JSON.stringify({ type: "ping", nonce: 99 }));
    expect(await pongResponse).toEqual({ type: "pong", nonce: 99 });
    socket.close();
  });

  it("rejects socket attempts to buy into an AI seat without changing room state", async () => {
    const { humanActorId, room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    await joinClient(socket, tableId, humanActorId);
    const aiSeatId = room
      .getSnapshot()
      .seats.find((seat) => seat.occupantId !== humanActorId)?.seatId;
    expect(aiSeatId).toBeDefined();
    const snapshotBefore = room.getSnapshot();
    const eventCountBefore = store.count();
    const response = waitForMessage(socket, (message) => message.type === "error");

    socket.send(
      JSON.stringify({
        type: "submit_intent",
        requestId: "ai-seat-request",
        intent: {
          type: "buy_in",
          actorId: humanActorId,
          seatId: aiSeatId,
          amount: 100,
        },
      }),
    );

    expect(await response).toMatchObject({
      type: "error",
      code: "intent_not_allowed",
    });
    expect(room.getSnapshot()).toEqual(snapshotBefore);
    expect(store.count()).toBe(eventCountBefore);
    socket.close();
  });

  it("rejects dealer-only socket intents without changing room state", async () => {
    const { humanActorId, room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    await joinClient(socket, tableId, humanActorId);
    const snapshotBefore = room.getSnapshot();
    const eventCountBefore = store.count();
    const response = waitForMessage(socket, (message) => message.type === "error");

    socket.send(
      JSON.stringify({
        type: "submit_intent",
        requestId: "dealer-request",
        intent: { type: "start_round", actorId: humanActorId },
      }),
    );

    expect(await response).toMatchObject({
      type: "error",
      code: "intent_not_allowed",
    });
    expect(room.getSnapshot()).toEqual(snapshotBefore);
    expect(store.count()).toBe(eventCountBefore);
    socket.close();
  });

  it("allows the joined human to bet from their authorized seat", async () => {
    const { humanActorId, room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    await joinClient(socket, tableId, humanActorId);
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const eventCountBefore = store.count();
    const acceptedBet = waitForMessage(
      socket,
      (message) =>
        message.type === "event" &&
        message.event.intent?.type === "place_bet" &&
        message.event.accepted,
    );
    const intentResult = waitForMessage(
      socket,
      (message) => message.type === "intent_result",
    );

    socket.send(
      JSON.stringify({
        type: "submit_intent",
        requestId: "accepted-request",
        intent: {
          type: "place_bet",
          actorId: humanActorId,
          seatId: room.getHumanSeatId(),
          betKind: "player",
          amount: 100,
        },
      }),
    );

    expect(await acceptedBet).toMatchObject({
      type: "event",
      event: { accepted: true, actorId: humanActorId },
    });
    const result = await intentResult;
    expect(result).toMatchObject({
      type: "intent_result",
      requestId: "accepted-request",
      event: { accepted: true },
    });
    expect(store.count()).toBe(eventCountBefore + 1);
    socket.close();
  });

  it("does not execute a repeated request identifier twice", async () => {
    const { humanActorId, room, store, tableId, url } = await createGateway();
    const socket = await connectClient(url);
    await joinClient(socket, tableId, humanActorId);
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const eventCountBefore = store.count();
    const request = {
      type: "submit_intent",
      requestId: "same-request",
      intent: {
        type: "place_bet",
        actorId: humanActorId,
        seatId: room.getHumanSeatId(),
        betKind: "player",
        amount: 100,
      },
    };
    const firstResult = waitForMessage(socket, (message) => message.type === "intent_result");
    socket.send(JSON.stringify(request));
    await firstResult;
    const duplicateError = waitForMessage(
      socket,
      (message) => message.type === "error" && message.code === "duplicate_request",
    );
    socket.send(JSON.stringify(request));

    expect(await duplicateError).toMatchObject({
      type: "error",
      code: "duplicate_request",
      requestId: "same-request",
    });
    expect(store.count()).toBe(eventCountBefore + 1);
    socket.close();
  });

  it("reports internal failures but sends a stable non-sensitive message", async () => {
    const reportedErrors: unknown[] = [];
    const { humanActorId, room, store, tableId, url } = await createGateway((error) => {
      reportedErrors.push(error);
    });
    const socket = await connectClient(url);
    await joinClient(socket, tableId, humanActorId);
    store.shouldFailAppend = true;
    const response = waitForMessage(socket, (message) => message.type === "error");

    socket.send(
      JSON.stringify({
        type: "submit_intent",
        requestId: "failure-request",
        intent: {
          type: "place_bet",
          actorId: humanActorId,
          seatId: room.getHumanSeatId(),
          betKind: "player",
          amount: 100,
        },
      }),
    );

    expect(await response).toEqual({
      type: "error",
      code: "internal_error",
      message: "Intent submission failed",
      requestId: "failure-request",
    });
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toBeInstanceOf(RoomFaultedError);
    expect((reportedErrors[0] as RoomFaultedError).rootCause).toEqual(
      new Error("sensitive database detail"),
    );
    socket.close();
  });

  it("rejects new joins to a faulted room without exposing its divergent snapshot", async () => {
    const { humanActorId, room, store, tableId, url } = await createGateway(
      () => undefined,
    );
    const joinedSocket = await connectClient(url);
    await joinClient(joinedSocket, tableId, humanActorId);
    store.shouldFailAppend = true;
    const faultResponse = waitForMessage(
      joinedSocket,
      (message) => message.type === "error",
    );

    joinedSocket.send(
      JSON.stringify({
        type: "submit_intent",
        requestId: "fault-request",
        intent: {
          type: "place_bet",
          actorId: humanActorId,
          seatId: room.getHumanSeatId(),
          betKind: "player",
          amount: 100,
        },
      }),
    );
    await faultResponse;
    expect(room.isFaulted()).toBe(true);

    const newSocket = await connectClient(url);
    const joinResponse = await joinClient(
      newSocket,
      tableId,
      humanActorId,
      JOIN_CREDENTIAL,
    );

    expect(joinResponse).toEqual({
      type: "error",
      code: "room_unavailable",
      message: "Room is unavailable",
    });
    expect(JSON.stringify(joinResponse)).not.toContain("sensitive database detail");
    expect(joinResponse).not.toHaveProperty("snapshot");
    joinedSocket.close();
    newSocket.close();
  });

  it("handles server and socket errors through the injected reporter", async () => {
    const reportedErrors: unknown[] = [];
    const { humanActorId, tableId, url, webSocketServer } = await createGateway(
      (error) => reportedErrors.push(error),
    );
    const clientSocket = await connectClient(url);
    await joinClient(clientSocket, tableId, humanActorId);
    const serverSocket = [...webSocketServer.clients][0];
    expect(serverSocket).toBeDefined();

    webSocketServer.emit("error", new Error("server transport detail"));
    serverSocket!.emit("error", new Error("socket transport detail"));

    expect(reportedErrors).toEqual([
      new Error("server transport detail"),
      new Error("socket transport detail"),
    ]);
    clientSocket.close();
  });
});
