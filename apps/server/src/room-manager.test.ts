/**
 * RoomManager tests.
 *
 * A room must seat and fund its actors so betting is never rejected for an
 * empty stack, drive a full round to a settled outcome, and append every engine
 * event to the store. These run without opening a socket.
 */
import { describe, expect, it } from "vitest";
import {
  asActorId,
  asTableId,
  SYSTEM_DEALER,
  type TableEvent,
  type TableId,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { MemoryEventStore, type EventStore } from "./memory-event-store.js";
import { RoomFaultedError, RoomManager } from "./room-manager.js";

function devPack(): RulePack {
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

const TABLE_ID = asTableId("table-1");
const HUMAN = asActorId("human-1");
const JOIN_CREDENTIAL = "room-test-credential";

function createRoom() {
  const store = new MemoryEventStore();
  const manager = new RoomManager(store);
  const room = manager.createRoom({
    tableId: TABLE_ID,
    rulePack: devPack(),
    humanActorId: HUMAN,
    joinCredential: JOIN_CREDENTIAL,
    seatCount: 3,
    aiCount: 2,
    shoeSeed: "room-seed-1",
  });
  return { store, manager, room };
}

class FailingEventStore implements EventStore {
  private readonly events: TableEvent[] = [];
  shouldFailAppend = false;
  appendAttempts = 0;

  append(event: TableEvent): void {
    this.appendAttempts += 1;
    if (this.shouldFailAppend) {
      throw new Error("append failed");
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

describe("RoomManager", () => {
  it("requires the configured human actor and credential together", () => {
    const { manager, room } = createRoom();
    const aiActorId = room
      .getSnapshot()
      .seats.map((seat) => seat.occupantId)
      .find((actorId) => actorId !== null && actorId !== HUMAN);

    expect(room.canClientJoin(HUMAN, JOIN_CREDENTIAL)).toBe(true);
    expect(manager.canClientJoin(TABLE_ID, HUMAN, JOIN_CREDENTIAL)).toBe(true);
    expect(room.canClientJoin(HUMAN, "wrong-credential")).toBe(false);
    expect(room.canClientJoin(asActorId("intruder"), JOIN_CREDENTIAL)).toBe(false);
    expect(aiActorId).toBeDefined();
    expect(room.canClientJoin(aiActorId!, JOIN_CREDENTIAL)).toBe(false);
    expect(room.canClientJoin(SYSTEM_DEALER, JOIN_CREDENTIAL)).toBe(false);
  });

  it("authorizes ordinary client intents only for the human actor and seat", () => {
    const { room } = createRoom();
    const aiSeatId = room
      .getSnapshot()
      .seats.find((seat) => seat.occupantId !== HUMAN)?.seatId;
    expect(aiSeatId).toBeDefined();

    expect(
      room.isClientIntentAllowed({
        type: "place_bet",
        actorId: HUMAN,
        seatId: room.getHumanSeatId(),
        betKind: "player",
        amount: 100,
      }),
    ).toBe(true);
    expect(
      room.isClientIntentAllowed({
        type: "buy_in",
        actorId: HUMAN,
        seatId: aiSeatId!,
        amount: 100,
      }),
    ).toBe(false);
    expect(
      room.isClientIntentAllowed({ type: "start_round", actorId: HUMAN }),
    ).toBe(false);
  });

  it("publishes player-only session capabilities for the current room", () => {
    const { room } = createRoom();

    expect(room.getClientCapabilities(HUMAN)).toEqual({
      canBet: true,
      canClearBets: true,
      canControlDealer: false,
    });
  });

  it("funds every seat at creation", () => {
    const { room } = createRoom();
    const snapshot = room.getSnapshot();
    for (const seat of snapshot.seats) {
      if (seat.occupantId !== null) {
        expect(seat.stack).toBeGreaterThan(0);
      }
    }
  });

  it("records the buy-in events in the store", () => {
    const { store } = createRoom();
    const events = store.listByTable(TABLE_ID);
    const buyIns = events.filter((event) => event.intent?.type === "buy_in");
    // One human seat plus two AI seats.
    expect(buyIns).toHaveLength(3);
  });

  it("rejects a duplicate table id without writing more buy-in events", () => {
    const { manager, room, store } = createRoom();
    const eventCountBeforeDuplicate = store.count();

    expect(() =>
      manager.createRoom({
        tableId: TABLE_ID,
        rulePack: devPack(),
        humanActorId: asActorId("another-human"),
        joinCredential: "another-credential",
        seatCount: 2,
        aiCount: 1,
        shoeSeed: "another-seed",
      }),
    ).toThrow(`Room already exists for table ${TABLE_ID}`);

    expect(store.count()).toBe(eventCountBeforeDuplicate);
    expect(manager.getRoom(TABLE_ID)).toBe(room);
  });

  it("drives a full automatic round to a settled outcome", () => {
    const { room } = createRoom();
    room.playAutomaticRound();
    const snapshot = room.getSnapshot();
    expect(snapshot.phase).toBe("round_end");
    expect(snapshot.outcome).not.toBeNull();
  });

  it("stops an automatic round immediately when start_round is rejected", () => {
    const { room, store } = createRoom();
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    const eventCountBeforeAutomaticRound = store.count();

    expect(() => room.playAutomaticRound()).toThrow(
      "Automatic round intent start_round was rejected: wrong_phase",
    );

    expect(store.count()).toBe(eventCountBeforeAutomaticRound + 1);
    const lastEvent = store.listByTable(TABLE_ID).at(-1);
    expect(lastEvent?.intent?.type).toBe("start_round");
    expect(lastEvent?.accepted).toBe(false);
    expect(lastEvent?.rejectReason).toBe("wrong_phase");
  });

  it("appends every accepted engine event to the store", () => {
    const { store, room } = createRoom();
    const before = store.count();
    room.playAutomaticRound();
    const after = store.count();
    // A round appends start, AI bets, no-more-bets, several deals and settle.
    expect(after).toBeGreaterThan(before);

    // Every stored event should be one the engine actually accepted or logged.
    const events = store.listByTable(TABLE_ID);
    const settle = events.find((event) => event.intent?.type === "settle_round");
    expect(settle?.accepted).toBe(true);
    expect(settle?.outcome).not.toBeUndefined();
  });

  it("accepts every AI bet using the actor occupying its seat", () => {
    const { store, room } = createRoom();
    room.playAutomaticRound();

    const occupantsBySeat = new Map(
      room.getSnapshot().seats.map((seat) => [seat.seatId, seat.occupantId]),
    );
    const aiBetEvents = store
      .listByTable(TABLE_ID)
      .filter((event) => event.intent?.type === "place_bet");

    expect(aiBetEvents).toHaveLength(2);
    for (const event of aiBetEvents) {
      expect(event.accepted).toBe(true);
      expect(event.rejectReason).not.toBe("not_authorised");
      if (event.intent?.type === "place_bet") {
        expect(event.actorId).toBe(occupantsBySeat.get(event.intent.seatId));
      }
    }
  });

  it("assigns a unique actor identity to every AI seat", () => {
    const { room } = createRoom();
    const aiActorIds = room
      .getSnapshot()
      .seats.map((seat) => seat.occupantId)
      .filter((actorId) => actorId !== null && actorId !== HUMAN);

    expect(aiActorIds).toHaveLength(2);
    expect(new Set(aiActorIds).size).toBe(aiActorIds.length);
  });

  it("repeats AI bets and revealed cards for the same seed", () => {
    const first = createRoom();
    first.room.playAutomaticRound();
    const second = createRoom();
    second.room.playAutomaticRound();

    const selectDeterministicRoundEvents = (store: MemoryEventStore) =>
      store
        .listByTable(TABLE_ID)
        .filter(
          (event) =>
            event.intent?.type === "place_bet" ||
            (event.cardsRevealed?.length ?? 0) > 0,
        )
        .map((event) => ({
          intent: event.intent,
          cardsRevealed: event.cardsRevealed,
          accepted: event.accepted,
          phaseAfter: event.phaseAfter,
        }));

    const firstEvents = selectDeterministicRoundEvents(first.store);
    const secondEvents = selectDeterministicRoundEvents(second.store);

    expect(firstEvents).toEqual(secondEvents);
    expect(firstEvents.some((event) => event.intent?.type === "place_bet")).toBe(
      true,
    );
    expect(
      firstEvents.some((event) => (event.cardsRevealed?.length ?? 0) > 0),
    ).toBe(true);
    expect(first.room.getSnapshot().outcome).toBe(
      second.room.getSnapshot().outcome,
    );
  });

  it("faults permanently after append failure and rejects further operations", () => {
    const store = new FailingEventStore();
    const manager = new RoomManager(store);
    const room = manager.createRoom({
      tableId: TABLE_ID,
      rulePack: devPack(),
      humanActorId: HUMAN,
      joinCredential: JOIN_CREDENTIAL,
      seatCount: 2,
      aiCount: 1,
      shoeSeed: "fault-seed",
    });
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
    store.shouldFailAppend = true;

    expect(() =>
      room.submitIntent({
        type: "place_bet",
        actorId: HUMAN,
        seatId: room.getHumanSeatId(),
        betKind: "player",
        amount: 100,
      }),
    ).toThrow(RoomFaultedError);

    expect(room.isFaulted()).toBe(true);
    expect(manager.isRoomFaulted(TABLE_ID)).toBe(true);
    expect(room.canClientJoin(HUMAN, JOIN_CREDENTIAL)).toBe(false);
    expect(manager.canClientJoin(TABLE_ID, HUMAN, JOIN_CREDENTIAL)).toBe(false);
    const snapshotAfterFailure = room.getSnapshot();
    const eventCountAfterFailure = store.count();
    const appendAttemptsAfterFailure = store.appendAttempts;

    expect(() =>
      room.submitIntent({
        type: "clear_bets",
        actorId: HUMAN,
        seatId: room.getHumanSeatId(),
      }),
    ).toThrow(RoomFaultedError);
    expect(() => room.playAutomaticRound()).toThrow(RoomFaultedError);

    expect(room.getSnapshot()).toEqual(snapshotAfterFailure);
    expect(store.count()).toBe(eventCountAfterFailure);
    expect(store.appendAttempts).toBe(appendAttemptsAfterFailure);
  });
});
