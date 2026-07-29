import { describe, expect, it, vi } from "vitest";
import { asActorId, asRoundId, asSeatId, asTableId, type TableEvent, type TableSnapshot } from "@mct/shared";
import {
  REMOTE_COMMAND_RECOVERY_WINDOW_MS,
  ROOM_PROTOCOL_VERSION,
  type JoinedMessage,
  type ServerMessage,
} from "@mct/room-protocol";
import type { RoomConnectionStateSnapshot } from "@mct/room-client";
import {
  RemoteTableSession,
  UnsupportedSessionCommandError,
  type RemoteRoomConnection,
} from "./remote-table-session.js";

const actorId = asActorId("remote-human");
const seatId = asSeatId("opaque-seat-identity");
const snapshot = {
  tableId: asTableId("remote-table"),
  roundId: asRoundId("round-1"),
  phase: "round_betting",
  seats: [{ seatId, occupantId: actorId, stack: 1_000 }],
  bets: [],
  hands: { player: [], banker: [], playerTotal: 0, bankerTotal: 0 },
  outcome: null,
  rulePackId: "remote-pack",
  rulePackVersion: "1.0.0",
  lastEventSeq: 1,
} as TableSnapshot;
const joined: JoinedMessage = {
  type: "joined",
  roomInstanceId: "instance-1",
  tableId: snapshot.tableId,
  actorId,
  protocolVersion: ROOM_PROTOCOL_VERSION,
  snapshot,
  rulePack: {
    id: "remote-pack",
    version: "1.0.0",
    displayName: "Remote pack",
    variant: "standard",
    limits: { min: 100, max: 10_000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  },
  seats: [{ seatId, label: 7, occupantId: actorId }],
  capabilities: {
    canBet: true,
    canClearBets: true,
    canControlDealer: false,
  },
};

class FakeConnection implements RemoteRoomConnection {
  readonly sent: Array<{ requestId: string; intent: unknown }> = [];
  closed = false;
  closeCalls = 0;
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly stateListeners = new Set<(state: RoomConnectionStateSnapshot) => void>();

  connect(): Promise<JoinedMessage> {
    return Promise.resolve(joined);
  }

  submitIntent(requestId: string, intent: never): Promise<void> {
    this.sent.push({ requestId, intent });
    return Promise.resolve();
  }

  subscribeMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  subscribeState(listener: (state: RoomConnectionStateSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  close(): void {
    this.closeCalls += 1;
    this.closed = true;
  }

  emitMessage(message: ServerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitState(state: RoomConnectionStateSnapshot): void {
    for (const listener of this.stateListeners) listener(state);
  }
}

function createAcceptedEvent(sequence: number): TableEvent {
  return {
    tableId: snapshot.tableId,
    roundId: snapshot.roundId,
    seq: sequence,
    actorId,
    phaseAfter: "round_betting",
    rulePackId: "remote-pack",
    rulePackVersion: "1.0.0",
    at: sequence,
    intent: { type: "place_bet", actorId, seatId, betKind: "player", amount: 100 },
    accepted: true,
  };
}

describe("RemoteTableSession", () => {
  it("exposes authoritative player capabilities and rejects dealer commands locally", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });

    expect(session.getCapabilities()).toEqual(joined.capabilities);
    await expect(session.closeBetting()).rejects.toBeInstanceOf(UnsupportedSessionCommandError);
    await expect(session.dealNext()).rejects.toBeInstanceOf(UnsupportedSessionCommandError);
    await expect(session.settleRound()).rejects.toBeInstanceOf(UnsupportedSessionCommandError);
    await expect(session.startRound()).rejects.toBeInstanceOf(UnsupportedSessionCommandError);
    expect(connection.sent).toHaveLength(0);
  });

  it("closes an owned connection exactly once when connect rejects", async () => {
    const connection = new FakeConnection();
    const originalError = new Error("connect timeout");
    connection.connect = () => Promise.reject(originalError);

    await expect(RemoteTableSession.create({ connection })).rejects.toBe(originalError);
    expect(connection.closeCalls).toBe(1);
  });

  it("closes an owned connection exactly once when bootstrap validation fails", async () => {
    const connection = new FakeConnection();
    connection.connect = () => Promise.resolve({
      ...joined,
      seats: [{ seatId, label: 7, occupantId: null }],
    });

    await expect(RemoteTableSession.create({ connection })).rejects.toThrow(/authoritative seat/i);
    expect(connection.closeCalls).toBe(1);
  });

  it("uses bootstrap descriptors and correlates an authoritative result", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection, commandTimeoutMs: 1_000 });

    expect(session.getGuestSeat()).toEqual({ label: 7, seatId, occupantId: actorId });
    expect(session.getRulePack()).toEqual(joined.rulePack);
    const command = session.placeBet(7, "player", 100);
    const sent = connection.sent[0]!;
    expect(sent.requestId).toBeTruthy();
    expect(sent.intent).toMatchObject({ actorId, seatId });
    const event = createAcceptedEvent(2);
    connection.emitMessage({ type: "intent_result", roomInstanceId: joined.roomInstanceId, requestId: sent.requestId, event });

    await expect(command).resolves.toEqual(event);
    session.dispose();
    expect(connection.closed).toBe(true);
  });

  it("pairs out-of-order event and snapshot once", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection, commandTimeoutMs: 1_000 });
    const updates: number[] = [];
    session.subscribe((update) => updates.push(update.snapshot.lastEventSeq));
    const event = createAcceptedEvent(2);
    const nextSnapshot = { ...snapshot, lastEventSeq: 2 };

    connection.emitMessage({ type: "snapshot", roomInstanceId: joined.roomInstanceId, snapshot: nextSnapshot });
    connection.emitMessage({ type: "event", roomInstanceId: joined.roomInstanceId, event });
    connection.emitMessage({ type: "event", roomInstanceId: joined.roomInstanceId, event });
    expect(updates).toEqual([2]);
    expect(session.getSnapshot()).toEqual(nextSnapshot);
  });

  it("resends within the total recovery deadline without extending it across reconnects", async () => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection, commandTimeoutMs: 20 });
    const pending = session.placeBet(7, "player", 100);
    const originalRequest = connection.sent[0]!;

    connection.emitState({ state: "reconnecting", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 1, lastError: new Error("lost") });
    await vi.advanceTimersByTimeAsync(15);
    connection.emitMessage({ ...joined, snapshot: { ...snapshot, lastEventSeq: 2 } });
    connection.emitState({ state: "connected", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 0, lastError: null });

    expect(connection.sent).toHaveLength(2);
    expect(connection.sent[1]).toEqual(originalRequest);
    const pendingRejection = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(5);
    await pendingRejection;

    connection.emitState({ state: "reconnecting", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 1, lastError: new Error("lost again") });
    connection.emitMessage({ ...joined, snapshot: { ...snapshot, lastEventSeq: 2 } });
    connection.emitState({ state: "connected", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 0, lastError: null });
    expect(connection.sent).toHaveLength(2);
    vi.useRealTimers();
  });

  it("uses the shared recovery window by default and expires while disconnected", async () => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });
    const pending = session.placeBet(7, "player", 100);

    connection.emitState({ state: "reconnecting", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 1, lastError: new Error("lost") });
    const pendingRejection = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(REMOTE_COMMAND_RECOVERY_WINDOW_MS);

    await pendingRejection;
    connection.emitMessage(joined);
    connection.emitState({ state: "connected", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 0, lastError: null });
    expect(connection.sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it("fully resets on a new room instance and rejects old pending commands", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });
    const updates: Array<{ configurationChanged?: boolean }> = [];
    session.subscribe((update) => updates.push(update));
    const pending = session.placeBet(7, "player", 100);
    connection.emitState({ state: "reconnecting", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 1, lastError: new Error("lost") });
    const replacementSeatId = asSeatId("replacement-seat");
    const replacement = {
      ...joined,
      roomInstanceId: "instance-2",
      snapshot: { ...snapshot, lastEventSeq: 0, seats: [{ seatId: replacementSeatId, occupantId: actorId, stack: 500 }] },
      rulePack: { ...joined.rulePack, id: "replacement-pack", displayName: "Replacement pack" },
      seats: [{ seatId: replacementSeatId, label: 3, occupantId: actorId }],
    } satisfies JoinedMessage;

    connection.emitMessage(replacement);

    await expect(pending).rejects.toMatchObject({ name: "RoomInstanceChangedError" });
    expect(session.getRulePack().id).toBe("replacement-pack");
    expect(session.getSeats()).toEqual([{ seatId: replacementSeatId, label: 3, occupantId: actorId }]);
    expect(session.getSnapshot().lastEventSeq).toBe(0);
    expect(connection.sent).toHaveLength(1);
    expect(updates.at(-1)).toMatchObject({ configurationChanged: true });
  });

  it("rejects new commands while disconnected and ignores stale-instance updates", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });
    connection.emitState({ state: "disconnected", lastMessageAt: null, lastPongAt: null, reconnectAttempt: 1, lastError: new Error("lost") });

    await expect(session.placeBet(7, "player", 100)).rejects.toThrow(/disconnected/i);
    const reportSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    connection.emitMessage({ type: "snapshot", roomInstanceId: "stale-instance", snapshot: { ...snapshot, lastEventSeq: 99 } });

    expect(session.getSnapshot()).toEqual(snapshot);
    expect(connection.sent).toHaveLength(0);
    expect(reportSpy).toHaveBeenCalledWith(expect.stringContaining("stale room instance"));
    reportSpy.mockRestore();
  });

  it("keeps same-instance sequence monotonic after rejoin", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });

    connection.emitMessage({ ...joined, snapshot: { ...snapshot, lastEventSeq: 0 } });

    expect(session.getSnapshot()).toEqual(snapshot);
  });

  it("does not mark a same-instance bootstrap as a configuration reset", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });
    const listener = vi.fn();
    session.subscribe(listener);

    connection.emitMessage({ ...joined, snapshot: { ...snapshot, lastEventSeq: 2 } });

    expect(listener).toHaveBeenCalledWith(expect.not.objectContaining({
      configurationChanged: true,
    }));
  });

  it("rejects a command when its correlated engine event is rejected", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection });
    const pending = session.placeBet(7, "player", 100);
    const requestId = connection.sent[0]!.requestId;
    const rejectedEvent = {
      ...createAcceptedEvent(2),
      accepted: false,
      rejectReason: "wrong_phase" as const,
    };

    connection.emitMessage({ type: "intent_result", roomInstanceId: joined.roomInstanceId, requestId, event: rejectedEvent });

    await expect(pending).rejects.toThrow("wrong_phase");
  });
});
