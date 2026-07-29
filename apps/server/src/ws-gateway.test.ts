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
import { RoomManager } from "./room-manager.js";
import { getIntentActorError, WsGateway } from "./ws-gateway.js";

const openGateways: WsGateway[] = [];

afterEach(() => {
  for (const gateway of openGateways.splice(0)) {
    gateway.close();
  }
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
): Promise<ServerMessage> {
  const response = waitForMessage(
    socket,
    (message) => message.type === "joined" || message.type === "error",
  );
  socket.send(JSON.stringify({ type: "join_room", tableId, actorId }));
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

  it("broadcasts rejected event and snapshot updates to every joined client", async () => {
    const { humanActorId, tableId, url } = await createGateway();
    const firstSocket = await connectClient(url);
    const secondSocket = await connectClient(url);
    await Promise.all([
      joinClient(firstSocket, tableId, humanActorId),
      joinClient(secondSocket, tableId, humanActorId),
    ]);
    const firstEvent = waitForMessage(
      firstSocket,
      (message) => message.type === "event" && message.event.accepted === false,
    );
    const firstSnapshot = waitForMessage(firstSocket, (message) => message.type === "snapshot");
    const secondEvent = waitForMessage(
      secondSocket,
      (message) => message.type === "event" && message.event.accepted === false,
    );
    const secondSnapshot = waitForMessage(secondSocket, (message) => message.type === "snapshot");

    firstSocket.send(
      JSON.stringify({
        type: "submit_intent",
        intent: { type: "start_round", actorId: humanActorId },
      }),
    );

    const messages = await Promise.all([
      firstEvent,
      firstSnapshot,
      secondEvent,
      secondSnapshot,
    ]);
    const events = messages.filter((message) => message.type === "event");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "event",
      event: { accepted: false, rejectReason: "not_authorised" },
    });
    firstSocket.close();
    secondSocket.close();
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
    });
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]).toEqual(new Error("sensitive database detail"));
    socket.close();
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
