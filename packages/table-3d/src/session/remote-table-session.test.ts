import { describe, expect, it } from "vitest";
import { asActorId, asRoundId, asSeatId, asTableId, type TableEvent, type TableSnapshot } from "@mct/shared";
import { ROOM_PROTOCOL_VERSION, type JoinedMessage, type ServerMessage } from "@mct/room-protocol";
import type { RoomConnectionStateSnapshot } from "@mct/room-client";
import { RemoteTableSession, type RemoteRoomConnection } from "./remote-table-session.js";

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
};

class FakeConnection implements RemoteRoomConnection {
  readonly sent: Array<{ requestId: string; intent: unknown }> = [];
  closed = false;
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
    connection.emitMessage({ type: "intent_result", requestId: sent.requestId, event });

    await expect(command).resolves.toEqual(event);
    session.dispose();
    expect(connection.closed).toBe(true);
  });

  it("pairs out-of-order event and snapshot once and rejects pending on disconnect", async () => {
    const connection = new FakeConnection();
    const session = await RemoteTableSession.create({ connection, commandTimeoutMs: 1_000 });
    const updates: number[] = [];
    session.subscribe((update) => updates.push(update.snapshot.lastEventSeq));
    const event = createAcceptedEvent(2);
    const nextSnapshot = { ...snapshot, lastEventSeq: 2 };

    connection.emitMessage({ type: "snapshot", snapshot: nextSnapshot });
    connection.emitMessage({ type: "event", event });
    connection.emitMessage({ type: "event", event });
    expect(updates).toEqual([2]);

    const pending = session.clearBets(7);
    connection.emitState({
      state: "disconnected",
      lastMessageAt: null,
      lastPongAt: null,
      reconnectAttempt: 1,
      lastError: new Error("lost"),
    });
    await expect(pending).rejects.toThrow(/disconnected/i);
    expect(session.getSnapshot()).toEqual(nextSnapshot);
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

    connection.emitMessage({ type: "intent_result", requestId, event: rejectedEvent });

    await expect(pending).rejects.toThrow("wrong_phase");
  });
});
