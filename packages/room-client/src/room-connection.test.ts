import { ROOM_PROTOCOL_VERSION, type ClientMessage } from "@mct/room-protocol";
import { asActorId, asTableId, type TableSnapshot } from "@mct/shared";
import { describe, expect, it } from "vitest";
import { RoomConnection, RoomConnectionUnavailableError } from "./room-connection.js";
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
  readyState = 0;
  closeCalls = 0;
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
    this.sentMessages.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.closeCalls += 1;
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

  it.each([
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
