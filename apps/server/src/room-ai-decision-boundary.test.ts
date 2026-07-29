import { describe, expect, it, vi } from "vitest";
import { asActorId, asTableId, type TableEvent } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import type { PlayerDecisionContext } from "./ai/player-decision-context.js";
import type { PlayerDecisionSource } from "./ai/player-decision-source.js";
import { MemoryEventStore } from "./memory-event-store.js";
import { RoomManager } from "./room-manager.js";

function createRulePack(): RulePack {
  return {
    id: "std",
    version: "1.0.0",
    displayName: "Standard",
    variant: "standard",
    limits: { min: 100, max: 1_000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [{ kind: "player_pair", payout: 11 }],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  };
}

describe("Room AI decision boundary", () => {
  it("passes only safe context and injects the seated identity itself", async () => {
    const contexts: PlayerDecisionContext[] = [];
    const source: PlayerDecisionSource = {
      decideBet: vi.fn(async (context) => {
        contexts.push(context);
        return {
          betKind: "banker",
          amount: 100,
          actorId: "model-supplied-actor",
          seatId: "model-supplied-seat",
        } as never;
      }),
    };
    const store = new MemoryEventStore();
    const room = new RoomManager(store).createRoom({
      tableId: asTableId("boundary-table"),
      rulePack: createRulePack(),
      humanActorId: asActorId("boundary-human"),
      joinCredential: "boundary-credential",
      seatCount: 2,
      aiCount: 1,
      shoeSeed: "boundary-seed",
      aiDecisionSourceFactory: () => source,
    });

    room.startAutomaticRound();
    await room.placeAutomaticPlayerBets(new AbortController().signal);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toEqual(
      expect.objectContaining({
        phase: "round_betting",
        stack: 10_000,
        allowedBetKinds: ["player", "banker", "tie", "player_pair"],
        limits: { min: 100, max: 1_000 },
      }),
    );
    const serializedContext = JSON.stringify(contexts[0]);
    expect(serializedContext).not.toMatch(/hands|cards|credential|actorId|seatId/i);

    const aiSeat = room.getSnapshot().seats.find(
      (seat) => seat.occupantId !== null && seat.occupantId !== asActorId("boundary-human"),
    );
    const betEvent = store
      .listByTable(asTableId("boundary-table"))
      .find((event) => event.intent?.type === "place_bet");
    expect(aiSeat).toBeDefined();
    expect(betEvent?.intent).toEqual({
      type: "place_bet",
      actorId: aiSeat?.occupantId,
      seatId: aiSeat?.seatId,
      betKind: "banker",
      amount: 100,
    });
  });

  it("publishes runtime rejection and continues to the next AI seat", async () => {
    const decisions = [
      { betKind: "player" as const, amount: 2_000 },
      { betKind: "banker" as const, amount: 100 },
    ];
    const publishedEvents: TableEvent[] = [];
    const store = new MemoryEventStore();
    const manager = new RoomManager(store);
    const tableId = asTableId("rejection-table");
    const room = manager.createRoom({
      tableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("rejection-human"),
      joinCredential: "rejection-credential",
      seatCount: 3,
      aiCount: 2,
      shoeSeed: "rejection-seed",
      aiDecisionSourceFactory: ({ index }) => ({
        decideBet: async () => decisions[index - 1] ?? null,
      }),
    });
    manager.subscribe(tableId, ({ event }) => publishedEvents.push(event));

    room.startAutomaticRound();
    await room.placeAutomaticPlayerBets(new AbortController().signal);

    const betEvents = publishedEvents.filter(
      (event) => event.intent?.type === "place_bet",
    );
    expect(betEvents).toHaveLength(2);
    expect(betEvents[0]).toEqual(
      expect.objectContaining({ accepted: false, rejectReason: "bet_above_maximum" }),
    );
    expect(betEvents[1]).toEqual(expect.objectContaining({ accepted: true }));
  });

  it("sits out and caches a rejected decision during a same-round restart", async () => {
    const decideBet = vi.fn()
      .mockRejectedValueOnce(new Error("temporary decision failure"))
      .mockResolvedValueOnce({ betKind: "player", amount: 100 });
    const store = new MemoryEventStore();
    const tableId = asTableId("decision-retry-table");
    const room = new RoomManager(store).createRoom({
      tableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("decision-retry-human"),
      joinCredential: "decision-retry-credential",
      seatCount: 2,
      aiCount: 1,
      shoeSeed: "decision-retry-seed",
      aiDecisionSourceFactory: () => ({ decideBet }),
    });

    room.startAutomaticRound();
    await expect(
      room.placeAutomaticPlayerBets(new AbortController().signal),
    ).resolves.toBeUndefined();
    await expect(
      room.placeAutomaticPlayerBets(new AbortController().signal),
    ).resolves.toBeUndefined();

    expect(decideBet).toHaveBeenCalledOnce();
    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(0);
  });
});
