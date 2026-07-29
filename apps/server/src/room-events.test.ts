import { describe, expect, it } from "vitest";
import { asActorId, asTableId, SYSTEM_DEALER } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { MemoryEventStore } from "./memory-event-store.js";
import type { RoomUpdate } from "./room-events.js";
import { RoomManager } from "./room-manager.js";

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

function createRoomManagerWithRoom(tableName: string) {
  const tableId = asTableId(tableName);
  const roomManager = new RoomManager(new MemoryEventStore());
  const room = roomManager.createRoom({
    tableId,
    rulePack: createRulePack(),
    humanActorId: asActorId(`${tableName}-human`),
    joinCredential: `${tableName}-credential`,
    seatCount: 3,
    aiCount: 2,
    shoeSeed: `${tableName}-seed`,
  });
  return { tableId, roomManager, room };
}

describe("authoritative room updates", () => {
  it("exposes subscriptions only through RoomManager", () => {
    const { room } = createRoomManagerWithRoom("manager-only-subscription");

    expect("subscribe" in room).toBe(false);
  });

  it("isolates listener failures and still reports an accepted submission", () => {
    const listenerErrors: unknown[] = [];
    const tableId = asTableId("listener-failure");
    const roomManager = new RoomManager(new MemoryEventStore(), {
      onListenerError: (error) => listenerErrors.push(error),
    });
    const room = roomManager.createRoom({
      tableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("listener-failure-human"),
      joinCredential: "listener-failure-credential",
      seatCount: 1,
      aiCount: 0,
      shoeSeed: "listener-failure-seed",
    });
    const receivedUpdates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, () => {
      throw new Error("observer failed");
    });
    roomManager.subscribe(tableId, (update) => receivedUpdates.push(update));

    const event = room.submitIntent({
      type: "start_round",
      actorId: SYSTEM_DEALER,
    });

    expect(event.accepted).toBe(true);
    expect(receivedUpdates).toHaveLength(1);
    expect(receivedUpdates[0]?.event).toBe(event);
    expect(listenerErrors).toHaveLength(1);
    expect(listenerErrors[0]).toEqual(new Error("observer failed"));
  });

  it("publishes rejected events and their aligned snapshots", () => {
    const { tableId, roomManager, room } = createRoomManagerWithRoom("rejected");
    const updates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, (update) => updates.push(update));
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });

    const rejectedEvent = room.submitIntent({
      type: "start_round",
      actorId: SYSTEM_DEALER,
    });

    expect(rejectedEvent.accepted).toBe(false);
    expect(rejectedEvent.rejectReason).toBe("wrong_phase");
    expect(updates.at(-1)?.event).toBe(rejectedEvent);
    expect(updates.at(-1)?.snapshot.lastEventSeq).toBe(rejectedEvent.seq);
  });

  it("publishes an event aligned with its authoritative snapshot", () => {
    const { tableId, roomManager, room } = createRoomManagerWithRoom("updates");
    const updates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, (update) => updates.push(update));

    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.event.seq).toBe(updates[0]?.snapshot.lastEventSeq);
  });

  it("publishes external, AI, and system dealer intents", () => {
    const { tableId, roomManager, room } = createRoomManagerWithRoom("sources");
    const updates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, (update) => updates.push(update));

    room.submitIntent({
      type: "place_bet",
      actorId: asActorId("sources-human"),
      seatId: room.getHumanSeatId(),
      betKind: "player",
      amount: 100,
    });
    room.playAutomaticRound();

    expect(
      updates.some(
        (update) => update.event.actorId === asActorId("sources-human"),
      ),
    ).toBe(true);
    expect(updates.some((update) => update.event.intent?.type === "place_bet")).toBe(true);
    expect(
      updates.some(
        (update) =>
          update.event.actorId === SYSTEM_DEALER &&
          update.event.intent?.type === "deal_next",
      ),
    ).toBe(true);
  });

  it("stops publishing after unsubscribe", () => {
    const { tableId, roomManager, room } = createRoomManagerWithRoom("unsubscribe");
    const updates: RoomUpdate[] = [];
    const unsubscribe = roomManager.subscribe(tableId, (update) => updates.push(update));

    unsubscribe();
    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });

    expect(updates).toHaveLength(0);
  });

  it("isolates listeners by table", () => {
    const store = new MemoryEventStore();
    const roomManager = new RoomManager(store);
    const firstTableId = asTableId("first-table");
    const secondTableId = asTableId("second-table");
    const firstRoom = roomManager.createRoom({
      tableId: firstTableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("first-human"),
      joinCredential: "first-credential",
      seatCount: 1,
      aiCount: 0,
      shoeSeed: "first-seed",
    });
    roomManager.createRoom({
      tableId: secondTableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("second-human"),
      joinCredential: "second-credential",
      seatCount: 1,
      aiCount: 0,
      shoeSeed: "second-seed",
    });
    const firstUpdates: RoomUpdate[] = [];
    const secondUpdates: RoomUpdate[] = [];
    roomManager.subscribe(firstTableId, (update) => firstUpdates.push(update));
    roomManager.subscribe(secondTableId, (update) => secondUpdates.push(update));

    firstRoom.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });

    expect(firstUpdates).toHaveLength(1);
    expect(secondUpdates).toHaveLength(0);
  });

  it("publishes one update for one externally submitted intent", () => {
    const { tableId, roomManager, room } = createRoomManagerWithRoom("single");
    const updates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, (update) => updates.push(update));

    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });

    expect(updates).toHaveLength(1);
  });

  it("allows subscribing before a room is created", () => {
    const tableId = asTableId("future-room");
    const roomManager = new RoomManager(new MemoryEventStore());
    const updates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, (update) => updates.push(update));
    const room = roomManager.createRoom({
      tableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("future-human"),
      joinCredential: "future-credential",
      seatCount: 1,
      aiCount: 0,
      shoeSeed: "future-seed",
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.event.intent?.type).toBe("buy_in");

    room.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });

    expect(updates).toHaveLength(2);
  });
});
