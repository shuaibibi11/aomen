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

  it("places fast AI bets during the window and closes betting when it expires", async () => {
    const { room, store, tableId } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    scheduler.start();

    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(0);

    await advance(0);

    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(2);

    await advance(TIMING.bettingWindowMs);

    expect(room.getSnapshot().phase).toBe("no_more_bets");
    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(2);
    expect(store.listByTable(tableId).at(-1)?.intent?.type).toBe("no_more_bets");
  });

  it("closes betting at the deadline without awaiting pending AI", async () => {
    let resolveAiBets!: () => void;
    const aiBets = new Promise<void>((resolve) => {
      resolveAiBets = resolve;
    });
    let phase = "idle" as ReturnType<AutomaticRoundRoom["getAutomaticRoundPhase"]>;
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(() => {
        phase = "round_betting";
      }),
      placeAutomaticPlayerBets: vi.fn(() => aiBets),
      closeAutomaticBetting: vi.fn(() => {
        phase = "no_more_bets";
      }),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => phase),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    expect(room.placeAutomaticPlayerBets).toHaveBeenCalledOnce();
    await advance(TIMING.bettingWindowMs);

    expect(room.closeAutomaticBetting).toHaveBeenCalledOnce();
    expect(phase).toBe("no_more_bets");

    resolveAiBets();
    await Promise.resolve();
    expect(room.closeAutomaticBetting).toHaveBeenCalledOnce();
  });

  it("rejects human bets and ignores a pending AI result after the deadline", async () => {
    const { humanActorId, room, store, tableId } = createRealRoom();
    let resolveAiBet!: (bet: unknown) => void;
    const firstAiSeat = (
      room as unknown as {
        aiSeats: Array<{
          ai: {
            decideBet: () => unknown;
          };
        }>;
      }
    ).aiSeats[0];
    if (firstAiSeat === undefined) {
      throw new Error("Expected a seated AI for the deadline test");
    }
    const originalDecision = firstAiSeat.ai.decideBet();
    firstAiSeat.ai.decideBet = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAiBet = resolve;
        }),
    );
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(TIMING.bettingWindowMs);

    expect(room.getSnapshot().phase).toBe("no_more_bets");
    const lateHumanBet = room.submitIntent({
      type: "place_bet",
      actorId: humanActorId,
      seatId: room.getHumanSeatId(),
      betKind: "player",
      amount: 100,
    });
    expect(lateHumanBet.accepted).toBe(false);

    resolveAiBet(originalDecision);
    await advance(0);
    expect(
      store
        .listByTable(tableId)
        .filter(
          (event) =>
            event.intent?.type === "place_bet" &&
            event.intent.actorId !== humanActorId,
        ),
    ).toHaveLength(0);
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
    expect(room.placeAutomaticPlayerBets).toHaveBeenCalledOnce();
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
    await Promise.resolve();
    await advance(100_000);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(thrownError);
    expect(scheduler.isRunning()).toBe(false);
    expect(room.closeAutomaticBetting).not.toHaveBeenCalled();
  });

  it("does not continue after stop while asynchronous AI betting is pending", async () => {
    let resolveAiBets!: () => void;
    let aiTaskSignal: AbortSignal | undefined;
    const aiBets = new Promise<void>((resolve) => {
      resolveAiBets = resolve;
    });
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn((signal) => {
        aiTaskSignal = signal;
        return aiBets;
      }),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "round_betting"),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    expect(room.placeAutomaticPlayerBets).toHaveBeenCalledOnce();
    scheduler.stop();
    expect(aiTaskSignal?.aborted).toBe(true);
    resolveAiBets();
    await Promise.resolve();

    expect(room.closeAutomaticBetting).not.toHaveBeenCalled();
    expect(room.dealNextAutomaticCard).not.toHaveBeenCalled();
  });

  it("ignores an old AI rejection after stop and restart", async () => {
    let rejectOldAiBets!: (error: Error) => void;
    const oldAiBets = new Promise<void>((_resolve, reject) => {
      rejectOldAiBets = reject;
    });
    const onError = vi.fn();
    let aiAttempt = 0;
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn(() => {
        aiAttempt += 1;
        return aiAttempt === 1 ? oldAiBets : Promise.resolve();
      }),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "round_betting"),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING, { onError });

    scheduler.start();
    scheduler.stop();
    scheduler.start();
    rejectOldAiBets(new Error("stale AI failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.isRunning()).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(room.placeAutomaticPlayerBets).toHaveBeenCalledTimes(2);
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
