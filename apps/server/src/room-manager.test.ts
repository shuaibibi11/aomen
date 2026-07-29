/**
 * RoomManager tests.
 *
 * A room must seat and fund its actors so betting is never rejected for an
 * empty stack, drive a full round to a settled outcome, and append every engine
 * event to the store. These run without opening a socket.
 */
import { describe, expect, it } from "vitest";
import { asActorId, asTableId } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { MemoryEventStore } from "./memory-event-store.js";
import { RoomManager } from "./room-manager.js";

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

function createRoom() {
  const store = new MemoryEventStore();
  const manager = new RoomManager(store);
  const room = manager.createRoom({
    tableId: TABLE_ID,
    rulePack: devPack(),
    humanActorId: HUMAN,
    seatCount: 3,
    aiCount: 2,
    shoeSeed: "room-seed-1",
  });
  return { store, manager, room };
}

describe("RoomManager", () => {
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

  it("drives a full automatic round to a settled outcome", () => {
    const { room } = createRoom();
    room.playAutomaticRound();
    const snapshot = room.getSnapshot();
    expect(snapshot.phase).toBe("round_end");
    expect(snapshot.outcome).not.toBeNull();
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

  it("produces the same outcome for the same seed", () => {
    const first = createRoom();
    first.room.playAutomaticRound();
    const second = createRoom();
    second.room.playAutomaticRound();
    expect(first.room.getSnapshot().outcome).toBe(
      second.room.getSnapshot().outcome,
    );
  });
});
