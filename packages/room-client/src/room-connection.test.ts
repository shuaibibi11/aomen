import { ROOM_PROTOCOL_VERSION, type ClientMessage } from "@mct/room-protocol";
import { asActorId, asTableId, type TableSnapshot } from "@mct/shared";
import { describe, expect, it } from "vitest";
import {
  JoinRejectedError,
  RoomConnection,
  RoomConnectionUnavailableError,
} from "./room-connection.js";
import type {
  TimerClock,
  WebSocketFactory,
  WebSocketLike,
  WebSocketMessageEvent,
} from "./websocket-adapter.js";

const snapshot = {
  tableId: "table-1",
  roundId: "round-1",
  phase: "round_betting",
  seats: [],
  bets: [],
  hands: { player: [], banker: [], playerTotal: 0, bankerTotal: 0 },
  outcome: null,
  rulePackId: "baccarat",
  rulePackVersion: "1.0.0",
  lastEventSeq: 0,
} as unknown as TableSnapshot;

type SocketEventType = "open" | "message" | "close" | "error";

class FakeSocket implements WebSocketLike {
  readonly sentMessages: ClientMessage[] = [];
  readonly closeArguments: Array<{ code: number | undefined; reason: string | undefined }> = [];
  readyState = 0;
  closeCalls = 0;
  closeError: Error | null = null;
  sendError: Error | null = null;
  private readonly listeners = new Map<SocketEventType, Set<(event: unknown) => void>>();

  addEventListener(type: SocketEventType, listener: (event: unknown) => void): void {
    const typeListeners = this.listeners.get(type) ?? new Set();
    typeListeners.add(listener);
    this.listeners.set(type, typeListeners);
  }

  removeEventListener(type: SocketEventType, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.sendError !== null) {
      throw this.sendError;
    }
    this.sentMessages.push(JSON.parse(data) as ClientMessage);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls += 1;
    this.closeArguments.push({ code, reason });
    if (this.closeError !== null) {
      throw this.closeError;
    }
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) } satisfies WebSocketMessageEvent);
  }

  closeFromNetwork(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  error(): void {
    this.emit("error", {});
  }

  private emit(type: SocketEventType, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

interface ScheduledTask {
  readonly identifier: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

class FakeClock implements TimerClock {
  currentTime = 0;
  private nextIdentifier = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  setTimeout(callback: () => void, delayMs: number): number {
    const identifier = this.nextIdentifier++;
    this.tasks.set(identifier, {
      identifier,
      dueAt: this.currentTime + delayMs,
      callback,
    });
    return identifier;
  }

  clearTimeout(identifier: unknown): void {
    this.tasks.delete(identifier as number);
  }

  now(): number {
    return this.currentTime;
  }

  advanceBy(durationMs: number): void {
    const targetTime = this.currentTime + durationMs;
    while (true) {
      const nextTask = [...this.tasks.values()]
        .filter((task) => task.dueAt <= targetTime)
        .sort((left, right) => left.dueAt - right.dueAt || left.identifier - right.identifier)[0];
      if (nextTask === undefined) {
        break;
      }
      this.currentTime = nextTask.dueAt;
      this.tasks.delete(nextTask.identifier);
      nextTask.callback();
    }
    this.currentTime = targetTime;
  }

  get pendingTaskCount(): number {
    return this.tasks.size;
  }

  get nextDelayMs(): number | undefined {
    const nextDueAt = Math.min(...[...this.tasks.values()].map((task) => task.dueAt));
    return Number.isFinite(nextDueAt) ? nextDueAt - this.currentTime : undefined;
  }
}

function createHarness(overrides: Partial<ConstructorParameters<typeof RoomConnection>[0]> = {}) {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  const websocketFactory: WebSocketFactory = {
    create: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
  const connection = new RoomConnection({
    url: "ws://room.test",
    tableId: asTableId("table-1"),
    actorId: asActorId("human-1"),
    credential: "room-secret",
    connectTimeoutMs: 2_000,
    joinTimeoutMs: 2_000,
    heartbeatIntervalMs: 1_000,
    pongTimeoutMs: 1_500,
    reconnectBaseDelayMs: 500,
    reconnectMaxDelayMs: 2_000,
    reconnectJitterRatio: 0,
    websocketFactory,
    clock,
    randomSource: { next: () => 0.5 },
    ...overrides,
  });
  return { connection, sockets, clock };
}

function join(socket: FakeSocket): void {
  socket.open();
  socket.message({
    type: "joined",
    tableId: "table-1",
    actorId: "human-1",
    protocolVersion: ROOM_PROTOCOL_VERSION,
    snapshot,
  });
}

describe("RoomConnection", () => {
  it("rejects a connection that never opens and reconnects after backoff", async () => {
    const { connection, sockets, clock } = createHarness();

    const connectionPromise = connection.connect();
    clock.advanceBy(2_000);

    await expect(connectionPromise).rejects.toThrow("WebSocket connect timeout");
    expect(sockets[0]?.closeCalls).toBe(1);
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(clock.nextDelayMs).toBe(500);

    clock.advanceBy(500);
    expect(sockets).toHaveLength(2);
  });

  it("rejects a connection that opens but never joins", async () => {
    const { connection, sockets, clock } = createHarness();

    const connectionPromise = connection.connect();
    sockets[0]?.open();
    clock.advanceBy(2_000);

    await expect(connectionPromise).rejects.toThrow("WebSocket join timeout");
    expect(sockets[0]?.closeCalls).toBe(1);
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(clock.nextDelayMs).toBe(500);
  });

  it("does not let an old handshake timeout close a newer socket", () => {
    const { connection, sockets, clock } = createHarness({
      connectTimeoutMs: 1_000,
      joinTimeoutMs: 2_000,
    });

    void connection.connect().catch(() => undefined);
    clock.advanceBy(1_000);
    clock.advanceBy(500);
    sockets[1]?.open();
    clock.advanceBy(500);

    expect(sockets[1]?.closeCalls).toBe(0);
    expect(connection.snapshot.state).toBe("joining");
  });

  it("waits for a fresh join when connect is called during reconnection", async () => {
    const { connection, sockets, clock } = createHarness();
    const firstSnapshot = { ...snapshot, lastEventSeq: 1 } as TableSnapshot;
    const rejoinedSnapshot = { ...snapshot, lastEventSeq: 2 } as TableSnapshot;
    const initialConnectionPromise = connection.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot: firstSnapshot,
    });
    await expect(initialConnectionPromise).resolves.toEqual(firstSnapshot);

    sockets[0]?.closeFromNetwork();
    const reconnectionPromise = connection.connect();
    const duplicateReconnectionPromise = connection.connect();
    expect(reconnectionPromise).toBe(duplicateReconnectionPromise);
    let reconnectionSettled = false;
    void reconnectionPromise.finally(() => { reconnectionSettled = true; });
    await Promise.resolve();
    expect(reconnectionSettled).toBe(false);

    clock.advanceBy(500);
    sockets[1]?.open();
    sockets[1]?.message({
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot: rejoinedSnapshot,
    });

    await expect(reconnectionPromise).resolves.toEqual(rejoinedSnapshot);
  });

  it("returns the last joined snapshot immediately while connected", async () => {
    const { connection, sockets } = createHarness();
    const joinedSnapshot = { ...snapshot, lastEventSeq: 3 } as TableSnapshot;
    const initialConnectionPromise = connection.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot: joinedSnapshot,
    });
    await initialConnectionPromise;

    await expect(connection.connect()).resolves.toStrictEqual(joinedSnapshot);
  });

  it("rejects a reconnection waiter and clears handshake timers when closed", async () => {
    const { connection, sockets, clock } = createHarness();
    const initialConnectionPromise = connection.connect();
    join(sockets[0]!);
    await initialConnectionPromise;
    sockets[0]?.closeFromNetwork();
    const reconnectionPromise = connection.connect();

    clock.advanceBy(500);
    expect(sockets).toHaveLength(2);
    connection.dispose();

    await expect(reconnectionPromise).rejects.toBeInstanceOf(RoomConnectionUnavailableError);
    expect(connection.snapshot.state).toBe("closed");
    expect(clock.pendingTaskCount).toBe(0);
  });

  it("connects, authenticates its join, and resolves the bootstrap snapshot", async () => {
    const { connection, sockets } = createHarness();
    const states: string[] = [];
    connection.subscribeState((state) => states.push(state.state));

    const bootstrapPromise = connection.connect();
    expect(states).toEqual(["idle", "connecting"]);
    sockets[0]?.open();
    expect(sockets[0]?.sentMessages).toEqual([{
      type: "join_room",
      tableId: "table-1",
      actorId: "human-1",
      credential: "room-secret",
    }]);
    expect(connection.snapshot.state).toBe("joining");
    sockets[0]?.message({
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot,
    });

    await expect(bootstrapPromise).resolves.toEqual(snapshot);
    expect(states).toEqual(["idle", "connecting", "joining", "connected"]);
  });

  it.each([
    "unknown_room",
    "not_joined",
    "actor_not_allowed",
    "actor_mismatch",
    "intent_not_allowed",
    "malformed_message",
  ] as const)("rejects bootstrap and stops reconnecting after permanent join error %s", async (code) => {
    const { connection, sockets, clock } = createHarness();
    const bootstrapPromise = connection.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      type: "error",
      code,
      message: "actor cannot join this room",
    });

    await expect(bootstrapPromise).rejects.toMatchObject({
      name: "JoinRejectedError",
      code,
    });
    await expect(bootstrapPromise).rejects.toBeInstanceOf(JoinRejectedError);
    expect(connection.snapshot.state).toBe("disconnected");
    expect(sockets[0]?.closeCalls).toBe(1);
    expect(clock.pendingTaskCount).toBe(0);
    expect(JSON.stringify(connection.snapshot.lastError)).not.toContain("room-secret");
  });

  it.each(["room_unavailable", "internal_error"] as const)(
    "rejects bootstrap but reconnects in the background after transient join error %s",
    async (code) => {
      const { connection, sockets, clock } = createHarness();
      const bootstrapPromise = connection.connect();
      sockets[0]?.open();
      sockets[0]?.message({
        type: "error",
        code,
        message: "room is temporarily unavailable",
      });

      await expect(bootstrapPromise).rejects.toMatchObject({
        name: "JoinRejectedError",
        code,
      });
      expect(connection.snapshot.state).toBe("reconnecting");
      expect(clock.nextDelayMs).toBe(500);

      clock.advanceBy(500);
      expect(sockets).toHaveLength(2);
      join(sockets[1]!);
      expect(connection.snapshot.state).toBe("connected");
    },
  );

  it("recovers when sending the join message throws without remaining in joining", async () => {
    const { connection, sockets, clock } = createHarness();
    const bootstrapPromise = connection.connect();
    sockets[0]!.sendError = new Error("join send failed");

    expect(() => sockets[0]?.open()).not.toThrow();
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(clock.nextDelayMs).toBe(500);

    clock.advanceBy(500);
    join(sockets[1]!);
    await expect(bootstrapPromise).resolves.toEqual(snapshot);
  });

  it("sends heartbeat pings and accepts matching pongs without reconnecting", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);

    clock.advanceBy(1_000);
    expect(sockets[0]?.sentMessages.at(-1)).toEqual({ type: "ping", nonce: 1 });
    clock.advanceBy(400);
    sockets[0]?.message({ type: "pong", nonce: 1 });
    expect(connection.snapshot.lastPongAt).toBe(1_400);
    clock.advanceBy(1_100);

    expect(sockets).toHaveLength(1);
    expect(connection.snapshot.state).toBe("connected");
  });

  it.each([0, 2])("does not clear a pong timeout for non-matching nonce %s", (nonce) => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);

    clock.advanceBy(1_000);
    sockets[0]?.message({ type: "pong", nonce });
    expect(connection.snapshot.lastPongAt).toBeNull();
    clock.advanceBy(1_500);

    expect(connection.snapshot.state).toBe("reconnecting");
    expect(sockets[0]?.closeCalls).toBe(1);
  });

  it("recovers from heartbeat send failures without throwing from its timer", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);
    sockets[0]!.sendError = new Error("heartbeat send failed");

    expect(() => clock.advanceBy(1_000)).not.toThrow();
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(sockets[0]?.closeCalls).toBe(1);
    expect(clock.nextDelayMs).toBe(500);
  });

  it("closes an unresponsive socket and reconnects after backoff", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);

    clock.advanceBy(2_500);
    expect(sockets[0]?.closeCalls).toBe(1);
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(clock.nextDelayMs).toBe(500);
    clock.advanceBy(500);
    expect(sockets).toHaveLength(2);
  });

  it("uses capped exponential backoff with symmetric jitter", () => {
    const { connection, sockets, clock } = createHarness({
      reconnectJitterRatio: 0.2,
      randomSource: { next: () => 1 },
    });
    void connection.connect();

    sockets[0]?.closeFromNetwork();
    expect(clock.nextDelayMs).toBe(600);
    clock.advanceBy(600);
    sockets[1]?.closeFromNetwork();
    expect(clock.nextDelayMs).toBe(1_200);
    clock.advanceBy(1_200);
    sockets[2]?.closeFromNetwork();
    expect(clock.nextDelayMs).toBe(2_000);
    clock.advanceBy(2_000);
    sockets[3]?.closeFromNetwork();
    expect(clock.nextDelayMs).toBe(2_000);
  });

  it("automatically rejoins and resets the attempt after a successful reconnect", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);
    sockets[0]?.closeFromNetwork();
    expect(connection.snapshot.reconnectAttempt).toBe(1);
    clock.advanceBy(500);
    join(sockets[1]!);
    expect(connection.snapshot.reconnectAttempt).toBe(0);
    expect(connection.snapshot.state).toBe("connected");
  });

  it("manual close is idempotent, removes listeners, and never reconnects", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);
    connection.close();
    connection.close();
    sockets[0]?.closeFromNetwork();
    clock.advanceBy(10_000);

    expect(connection.snapshot.state).toBe("closed");
    expect(sockets).toHaveLength(1);
    expect(clock.pendingTaskCount).toBe(0);
  });

  it("deduplicates close and error into one reconnect timer", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    sockets[0]?.error();
    sockets[0]?.closeFromNetwork();
    expect(clock.pendingTaskCount).toBe(1);
    expect(connection.snapshot.reconnectAttempt).toBe(1);
  });

  it("ignores delayed events from an old socket generation", () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    sockets[0]?.closeFromNetwork();
    clock.advanceBy(500);
    join(sockets[1]!);
    sockets[0]?.open();
    sockets[0]?.message({ type: "error", code: "internal_error", message: "stale" });
    sockets[0]?.closeFromNetwork();
    expect(connection.snapshot.state).toBe("connected");
    expect(connection.snapshot.lastError).toBeNull();
  });

  it("rejects application messages unless the room is joined", async () => {
    const { connection, sockets } = createHarness();
    expect(() => connection.sendClientMessage({ type: "ping", nonce: 9 })).toThrow(RoomConnectionUnavailableError);
    await expect(connection.submitIntent({ type: "start_round", actorId: asActorId("human-1") })).rejects.toThrow(RoomConnectionUnavailableError);
    void connection.connect();
    sockets[0]?.open();
    expect(() => connection.sendClientMessage({ type: "ping", nonce: 9 })).toThrow(RoomConnectionUnavailableError);
  });

  it("rejects an application send with its original error and reconnects", async () => {
    const { connection, sockets, clock } = createHarness();
    void connection.connect();
    join(sockets[0]!);
    const sendError = new Error("socket send failed");
    sockets[0]!.sendError = sendError;

    await expect(connection.submitIntent({
      type: "start_round",
      actorId: asActorId("human-1"),
    })).rejects.toBe(sendError);
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(sockets[0]?.closeCalls).toBe(1);
    expect(clock.nextDelayMs).toBe(500);
  });

  it("reports malformed messages, reconnects, and keeps listener delivery isolated", () => {
    const { connection, sockets, clock } = createHarness();
    const observedMessages: string[] = [];
    const observedErrors: Error[] = [];
    connection.subscribeMessage(() => { throw new Error("message listener failed"); });
    connection.subscribeMessage((message) => observedMessages.push(message.type));
    connection.subscribeState(() => { throw new Error("state listener failed"); });
    connection.subscribeError((error) => observedErrors.push(error));
    void connection.connect();
    join(sockets[0]!);

    sockets[0]?.message({ type: "pong", nonce: "malicious" });
    expect(connection.snapshot.lastError).toBeInstanceOf(Error);
    expect(observedErrors.map((error) => error.message)).toEqual(expect.arrayContaining([
      "state listener failed",
      "message listener failed",
    ]));
    expect(connection.snapshot.state).toBe("reconnecting");
    clock.advanceBy(500);
    join(sockets[1]!);
    expect(observedMessages).toEqual(["joined", "joined"]);
    expect(connection.snapshot.state).toBe("connected");
  });

  it("uses a bounded fixed close reason and reconnects when socket close throws", async () => {
    const { connection, sockets, clock } = createHarness();
    const bootstrapPromise = connection.connect();
    const uncontrolledError = new Error("sensitive-" + "x".repeat(500));
    sockets[0]!.sendError = uncontrolledError;
    sockets[0]!.closeError = new Error("fake close failed");

    expect(() => sockets[0]?.open()).not.toThrow();
    expect(sockets[0]?.closeArguments).toEqual([{
      code: 4000,
      reason: "Room transport failure",
    }]);
    expect(sockets[0]?.closeArguments[0]?.reason?.length).toBeLessThanOrEqual(123);
    expect(sockets[0]?.closeArguments[0]?.reason).not.toContain("sensitive");
    expect(connection.snapshot.state).toBe("reconnecting");

    clock.advanceBy(500);
    join(sockets[1]!);
    await expect(bootstrapPromise).resolves.toEqual(snapshot);
  });

  it("rejects a permanent join failure even when socket close throws", async () => {
    const { connection, sockets, clock } = createHarness();
    const bootstrapPromise = connection.connect();
    sockets[0]!.closeError = new Error("fake close failed");
    sockets[0]?.open();

    expect(() => sockets[0]?.message({
      type: "error",
      code: "actor_not_allowed",
      message: "private-" + "x".repeat(500),
    })).not.toThrow();

    await expect(bootstrapPromise).rejects.toBeInstanceOf(JoinRejectedError);
    expect(sockets[0]?.closeArguments).toEqual([{
      code: 4001,
      reason: "Room join rejected",
    }]);
    expect(connection.snapshot.state).toBe("disconnected");
    expect(clock.pendingTaskCount).toBe(0);
  });

  it.each([
    {
      name: "joined snapshot",
      message: {
        type: "joined",
        tableId: "table-1",
        actorId: "human-1",
        protocolVersion: ROOM_PROTOCOL_VERSION,
        snapshot: { ...snapshot, tableId: "table-2" },
      },
    },
    {
      name: "snapshot",
      message: {
        type: "snapshot",
        snapshot: { ...snapshot, tableId: "table-2" },
      },
    },
    {
      name: "event",
      message: {
        type: "event",
        event: {
          tableId: "table-2",
          roundId: "round-1",
          seq: 1,
          actorId: "human-1",
          phaseAfter: "round_betting",
          rulePackId: "baccarat",
          rulePackVersion: "1.0.0",
          at: 1,
        },
      },
    },
  ])("rejects cross-room $name messages without listener delivery", ({ message }) => {
    const { connection, sockets, clock } = createHarness();
    const observedMessages: string[] = [];
    connection.subscribeMessage((receivedMessage) => observedMessages.push(receivedMessage.type));
    void connection.connect();
    sockets[0]?.open();

    sockets[0]?.message(message);

    expect(observedMessages).toEqual([]);
    expect(connection.snapshot.state).toBe("reconnecting");
    expect(clock.nextDelayMs).toBe(500);
  });

  it("does not overwrite closed state when a joined listener disposes", async () => {
    const { connection, sockets, clock } = createHarness();
    connection.subscribeMessage((message) => {
      if (message.type === "joined") {
        connection.dispose();
      }
    });
    const bootstrapPromise = connection.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot,
    });

    await expect(bootstrapPromise).rejects.toBeInstanceOf(RoomConnectionUnavailableError);
    expect(connection.snapshot.state).toBe("closed");
    expect(clock.pendingTaskCount).toBe(0);
    expect(sockets[0]?.closeCalls).toBe(1);
  });

  it("does not reconnect when an error listener disposes during recovery", () => {
    const { connection, sockets, clock } = createHarness();
    connection.subscribeError(() => connection.dispose());
    void connection.connect();
    join(sockets[0]!);

    sockets[0]?.message({ type: "pong", nonce: "invalid" });

    expect(connection.snapshot.state).toBe("closed");
    expect(clock.pendingTaskCount).toBe(0);
    expect(sockets[0]?.closeCalls).toBe(1);
  });

  it("does not send join after a joining state listener disposes", async () => {
    const { connection, sockets, clock } = createHarness();
    connection.subscribeState((state) => {
      if (state.state === "joining") {
        connection.dispose();
      }
    });
    const bootstrapPromise = connection.connect();

    sockets[0]?.open();

    await expect(bootstrapPromise).rejects.toBeInstanceOf(RoomConnectionUnavailableError);
    expect(sockets[0]?.sentMessages).toEqual([]);
    expect(connection.snapshot.state).toBe("closed");
    expect(clock.pendingTaskCount).toBe(0);
  });

  it.each([
    { connectTimeoutMs: 0 },
    { joinTimeoutMs: Number.POSITIVE_INFINITY },
    { heartbeatIntervalMs: 0 },
    { pongTimeoutMs: 0 },
    { reconnectBaseDelayMs: -1 },
    { reconnectMaxDelayMs: 499 },
    { reconnectJitterRatio: -0.1 },
    { reconnectJitterRatio: 1.1 },
  ])("strictly rejects invalid timing configuration %#", (override) => {
    expect(() => createHarness(override)).toThrow(RangeError);
  });
});
