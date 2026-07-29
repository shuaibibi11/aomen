import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asActorId, asTableId } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import {
  AutomaticRoundScheduler,
  type AutomaticRoundRoom,
  type AutomaticRoundTiming,
} from "./automatic-round-scheduler.js";
import { MemoryEventStore } from "./memory-event-store.js";
import type { RoomUpdate } from "./room-events.js";
import { RoomManager } from "./room-manager.js";

const TIMING: AutomaticRoundTiming = {
  bettingWindowMs: 1_000,
  cardDealIntervalMs: 200,
  settlementDisplayMs: 500,
  interRoundDelayMs: 300,
};

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

function createRealRoom() {
  const tableId = asTableId("scheduler-table");
  const humanActorId = asActorId("scheduler-human");
  const store = new MemoryEventStore();
  const roomManager = new RoomManager(store);
  const room = roomManager.createRoom({
    tableId,
    rulePack: createRulePack(),
    humanActorId,
    joinCredential: "scheduler-credential",
    seatCount: 3,
    aiCount: 2,
    shoeSeed: "scheduler-seed",
  });
  return { humanActorId, room, roomManager, store, tableId };
}

async function advance(milliseconds: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
}

describe("AutomaticRoundScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens betting immediately and accepts a human bet during the window", async () => {
    const { humanActorId, room } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();

    expect(room.getSnapshot().phase).toBe("round_betting");
    const humanBet = room.submitIntent({
      type: "place_bet",
      actorId: humanActorId,
      seatId: room.getHumanSeatId(),
      betKind: "player",
      amount: 100,
    });
    expect(humanBet.accepted).toBe(true);

    await advance(TIMING.bettingWindowMs - 1);
    expect(room.getSnapshot().phase).toBe("round_betting");
  });

  it("places AI bets and closes betting only when the window expires", async () => {
    const { room, store, tableId } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    scheduler.start();

    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(0);

    await advance(TIMING.bettingWindowMs);

    expect(room.getSnapshot().phase).toBe("no_more_bets");
    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(2);
    expect(store.listByTable(tableId).at(-1)?.intent?.type).toBe("no_more_bets");
  });

  it("deals at most one card for each card interval and reaches round_end", async () => {
    const { room, store, tableId } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    scheduler.start();
    await advance(TIMING.bettingWindowMs);

    const countDeals = () =>
      store.listByTable(tableId).filter((event) => event.intent?.type === "deal_next")
        .length;

    expect(countDeals()).toBe(0);
    await advance(TIMING.cardDealIntervalMs - 1);
    expect(countDeals()).toBe(0);
    await advance(1);
    expect(countDeals()).toBe(1);
    await advance(TIMING.cardDealIntervalMs);
    expect(countDeals()).toBe(2);

    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }

    expect(room.getSnapshot().outcome).not.toBeNull();
  });

  it("publishes authoritative room updates for every scheduled phase", async () => {
    const { room, roomManager, tableId } = createRealRoom();
    const updates: RoomUpdate[] = [];
    roomManager.subscribe(tableId, (update) => updates.push(update));
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(TIMING.bettingWindowMs);
    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }

    const intentTypes = updates.map((update) => update.event.intent?.type);
    expect(intentTypes).toContain("start_round");
    expect(intentTypes).toContain("place_bet");
    expect(intentTypes).toContain("no_more_bets");
    expect(intentTypes).toContain("deal_next");
    expect(intentTypes).toContain("settle_round");
    expect(updates.every((update) => update.event.seq === update.snapshot.lastEventSeq)).toBe(
      true,
    );
  });

  it("stops all pending work and start is idempotent", async () => {
    const { room, store } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    scheduler.start();
    expect(
      store
        .listByTable(room.getSnapshot().tableId)
        .filter((event) => event.intent?.type === "start_round"),
    ).toHaveLength(1);

    scheduler.stop();
    const eventCountAfterStop = store.count();
    await advance(100_000);

    expect(scheduler.isRunning()).toBe(false);
    expect(store.count()).toBe(eventCountAfterStop);
  });

  it("stops before the next action when the room becomes faulted", async () => {
    let roomIsFaulted = false;
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn(),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "round_betting"),
      isFaulted: vi.fn(() => roomIsFaulted),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    roomIsFaulted = true;
    await advance(TIMING.bettingWindowMs);

    expect(scheduler.isRunning()).toBe(false);
    expect(room.placeAutomaticPlayerBets).not.toHaveBeenCalled();
  });

  it("reports an action failure once and stops", async () => {
    const thrownError = new Error("AI failed");
    const onError = vi.fn();
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn(() => {
        throw thrownError;
      }),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "round_betting"),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING, { onError });

    scheduler.start();
    await advance(TIMING.bettingWindowMs);
    await advance(100_000);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(thrownError);
    expect(scheduler.isRunning()).toBe(false);
    expect(room.closeAutomaticBetting).not.toHaveBeenCalled();
  });

  it("does not continue after stop while asynchronous AI betting is pending", async () => {
    let resolveAiBets!: () => void;
    const aiBets = new Promise<void>((resolve) => {
      resolveAiBets = resolve;
    });
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn(() => aiBets),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "round_betting"),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(TIMING.bettingWindowMs);
    scheduler.stop();
    resolveAiBets();
    await Promise.resolve();

    expect(room.closeAutomaticBetting).not.toHaveBeenCalled();
    expect(room.dealNextAutomaticCard).not.toHaveBeenCalled();
  });

  it.each([
    { ...TIMING, bettingWindowMs: -1 },
    { ...TIMING, cardDealIntervalMs: 0 },
    { ...TIMING, settlementDisplayMs: Number.NaN },
    { ...TIMING, interRoundDelayMs: Number.POSITIVE_INFINITY },
  ])("fails fast for invalid timing %#", (timing) => {
    const { room } = createRealRoom();
    expect(() => new AutomaticRoundScheduler(room, timing)).toThrow(
      "Invalid automatic round timing",
    );
  });
});
