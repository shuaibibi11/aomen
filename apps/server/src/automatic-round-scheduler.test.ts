import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asActorId, asTableId } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import {
  AutomaticRoundScheduler,
  type AutomaticRoundRoom,
  type AutomaticRoundTiming,
} from "./automatic-round-scheduler.js";
import { MemoryEventStore } from "./memory-event-store.js";
import type { EventStore } from "./memory-event-store.js";
import type { RoomUpdate } from "./room-events.js";
import { RoomManager } from "./room-manager.js";
import { FakeLlmProvider } from "./ai/fake-llm-provider.js";
import { LlmPlayerAi } from "./ai/llm-player-ai.js";

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

function expectNoRejectedStartRound(
  store: MemoryEventStore,
  tableId: ReturnType<typeof asTableId>,
): void {
  const rejectedStartRounds = store
    .listByTable(tableId)
    .filter(
      (event) => event.intent?.type === "start_round" && event.accepted !== true,
    );
  expect(rejectedStartRounds).toHaveLength(0);
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

  it("continues scheduling when every LLM provider request fails", async () => {
    const tableId = asTableId("provider-failure-scheduler-table");
    const rulePack = createRulePack();
    const store = new MemoryEventStore();
    const room = new RoomManager(store).createRoom({
      tableId,
      rulePack,
      humanActorId: asActorId("provider-failure-human"),
      joinCredential: "provider-failure-credential",
      seatCount: 3,
      aiCount: 2,
      shoeSeed: "provider-failure-seed",
      aiDecisionSourceFactory: ({ seed }) => new LlmPlayerAi({
        provider: new FakeLlmProvider([new Error("provider failed")]),
        model: "test-model",
        rulePack,
        seed,
        timeoutMs: 100,
      }),
    });
    const onError = vi.fn();
    const scheduler = new AutomaticRoundScheduler(room, TIMING, { onError });

    scheduler.start();
    await advance(0);

    expect(
      store.listByTable(tableId).filter((event) => event.intent?.type === "place_bet"),
    ).toHaveLength(2);
    expect(scheduler.isRunning()).toBe(true);
    expect(onError).not.toHaveBeenCalled();

    await advance(TIMING.bettingWindowMs);
    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }
    expect(scheduler.isRunning()).toBe(true);
  });

  it("falls back from fractional LLM wagers and completes the round", async () => {
    const tableId = asTableId("fractional-wager-scheduler-table");
    const rulePack = createRulePack();
    const store = new MemoryEventStore();
    const room = new RoomManager(store).createRoom({
      tableId,
      rulePack,
      humanActorId: asActorId("fractional-wager-human"),
      joinCredential: "fractional-wager-credential",
      seatCount: 3,
      aiCount: 2,
      shoeSeed: "fractional-wager-seed",
      aiDecisionSourceFactory: ({ seed }) => new LlmPlayerAi({
        provider: new FakeLlmProvider([{
          content: '{"action":"bet","betKind":"player","amount":100.5}',
        }]),
        model: "test-model",
        rulePack,
        seed,
        timeoutMs: 100,
      }),
    });
    const onError = vi.fn();
    const scheduler = new AutomaticRoundScheduler(room, TIMING, { onError });

    scheduler.start();
    await advance(0);

    const aiBetEvents = store
      .listByTable(tableId)
      .filter((event) => event.intent?.type === "place_bet");
    expect(aiBetEvents).toHaveLength(2);
    expect(aiBetEvents.every((event) => event.accepted === true)).toBe(true);
    expect(
      aiBetEvents.every((event) =>
        event.intent?.type === "place_bet" &&
        Number.isInteger(event.intent.amount) &&
        event.intent.amount >= rulePack.limits.min &&
        event.intent.amount <= rulePack.limits.max
      ),
    ).toBe(true);
    expect(onError).not.toHaveBeenCalled();

    await advance(TIMING.bettingWindowMs);
    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }

    expect(room.getSnapshot().outcome).not.toBeNull();
    expect(scheduler.isRunning()).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("closes betting at the deadline without awaiting pending AI", async () => {
    let resolveAiBets!: () => void;
    const aiBets = new Promise<void>((resolve) => {
      resolveAiBets = resolve;
    });
    let phase: ReturnType<AutomaticRoundRoom["getAutomaticRoundPhase"]> =
      "shoe_ready";
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
          decisionSource: {
            decideBet: () => unknown;
          };
        }>;
      }
    ).aiSeats[0];
    if (firstAiSeat === undefined) {
      throw new Error("Expected a seated AI for the deadline test");
    }
    const originalDecision = { betKind: "player" as const, amount: 100 };
    firstAiSeat.decisionSource.decideBet = vi.fn(
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

  it("does not repeat AI bets when restarted during betting", async () => {
    const { humanActorId, room, store, tableId } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    const getAiBetEvents = () =>
      store
        .listByTable(tableId)
        .filter(
          (event) =>
            event.intent?.type === "place_bet" &&
            event.intent.actorId !== humanActorId,
        );
    const getAiSeatStacks = () =>
      room
        .getSnapshot()
        .seats.filter((seat) => seat.occupantId !== humanActorId)
        .map((seat) => ({ seatId: seat.seatId, stack: seat.stack }));

    scheduler.start();
    await advance(0);

    const firstRoundBets = room.getSnapshot().bets;
    const firstRoundAiStacks = getAiSeatStacks();
    expect(firstRoundBets).toHaveLength(2);
    expect(getAiBetEvents()).toHaveLength(2);

    scheduler.stop();
    scheduler.start();
    await advance(0);

    expect(room.getSnapshot().bets).toEqual(firstRoundBets);
    expect(getAiSeatStacks()).toEqual(firstRoundAiStacks);
    expect(getAiBetEvents()).toHaveLength(2);

    await advance(TIMING.bettingWindowMs);
    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }
    await advance(TIMING.settlementDisplayMs + TIMING.interRoundDelayMs);
    await advance(0);

    expect(room.getSnapshot().phase).toBe("round_betting");
    expect(room.getSnapshot().bets).toHaveLength(2);
    expect(getAiBetEvents()).toHaveLength(4);
  });

  it("reuses an in-flight AI decision after stop and restart", async () => {
    const { humanActorId, room, store, tableId } = createRealRoom();
    const firstAiSeat = (
      room as unknown as {
        aiSeats: Array<{
          decisionSource: { decideBet: () => unknown };
        }>;
      }
    ).aiSeats[0];
    if (firstAiSeat === undefined) {
      throw new Error("Expected a seated AI for the restart test");
    }
    const originalDecision = { betKind: "player" as const, amount: 100 };
    let resolveDecision!: (decision: unknown) => void;
    const decideBet = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDecision = resolve;
        }),
    );
    firstAiSeat.decisionSource.decideBet = decideBet;
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(0);
    scheduler.stop();
    scheduler.start();
    await advance(0);
    expect(decideBet).toHaveBeenCalledOnce();

    resolveDecision(originalDecision);
    await advance(0);
    const firstAiActorId = room
      .getSnapshot()
      .seats.find((seat) => seat.occupantId?.includes("-ai-1"))
      ?.occupantId;
    const firstAiBets = store
      .listByTable(tableId)
      .filter(
        (event) =>
          event.intent?.type === "place_bet" && event.actorId === firstAiActorId,
      );
    expect(firstAiBets).toHaveLength(1);
    expect(firstAiBets[0]?.actorId).not.toBe(humanActorId);
  });

  it("caches a null AI decision across stop and restart", async () => {
    const { room } = createRealRoom();
    const firstAiSeat = (
      room as unknown as {
        aiSeats: Array<{
          decisionSource: { decideBet: () => unknown };
        }>;
      }
    ).aiSeats[0];
    if (firstAiSeat === undefined) {
      throw new Error("Expected a seated AI for the null-decision test");
    }
    const decideBet = vi.fn(() => null);
    firstAiSeat.decisionSource.decideBet = decideBet;
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(0);
    scheduler.stop();
    scheduler.start();
    await advance(0);

    expect(decideBet).toHaveBeenCalledOnce();
  });

  it("requests a new AI decision in the next round", async () => {
    const { room } = createRealRoom();
    const firstAiSeat = (
      room as unknown as {
        aiSeats: Array<{
          decisionSource: { decideBet: () => unknown };
        }>;
      }
    ).aiSeats[0];
    if (firstAiSeat === undefined) {
      throw new Error("Expected a seated AI for the next-round test");
    }
    const originalDecision = { betKind: "player" as const, amount: 100 };
    const decideBet = vi.fn(() => originalDecision);
    firstAiSeat.decisionSource.decideBet = decideBet;
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(0);
    await advance(TIMING.bettingWindowMs);
    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }
    await advance(TIMING.settlementDisplayMs + TIMING.interRoundDelayMs);
    await advance(0);

    expect(room.getSnapshot().phase).toBe("round_betting");
    expect(decideBet).toHaveBeenCalledTimes(2);
  });

  it("keeps only the current round AI decisions across multiple rounds", async () => {
    const { room } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    const getDecisionCacheSize = () =>
      (
        room as unknown as {
          aiDecisionCache: ReadonlyMap<string, unknown>;
        }
      ).aiDecisionCache.size;

    scheduler.start();
    for (let completedRoundCount = 0; completedRoundCount < 3; completedRoundCount += 1) {
      await advance(0);
      expect(room.getSnapshot().phase).toBe("round_betting");
      expect(getDecisionCacheSize()).toBeLessThanOrEqual(2);

      await advance(TIMING.bettingWindowMs);
      while (room.getSnapshot().phase !== "round_end") {
        await advance(TIMING.cardDealIntervalMs);
      }

      if (completedRoundCount < 2) {
        await advance(TIMING.settlementDisplayMs + TIMING.interRoundDelayMs);
      }
    }
  });

  it("does not submit an old round in-flight decision after a new round starts", async () => {
    const { humanActorId, room, store, tableId } = createRealRoom();
    const firstAiSeat = (
      room as unknown as {
        aiSeats: Array<{
          decisionSource: { decideBet: () => unknown };
        }>;
      }
    ).aiSeats[0];
    if (firstAiSeat === undefined) {
      throw new Error("Expected a seated AI for the stale decision test");
    }

    const originalDecision = { betKind: "player" as const, amount: 100 };
    let resolveOldDecision!: (decision: unknown) => void;
    firstAiSeat.decisionSource.decideBet = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldDecision = resolve;
          }),
      )
      .mockImplementation(() => null);
    const signal = new AbortController().signal;

    room.startAutomaticRound();
    const oldRoundBetting = room.placeAutomaticPlayerBets(signal);
    await advance(0);
    room.closeAutomaticBetting();
    room.dealNextAutomaticCard();
    while (room.getAutomaticRoundPhase() === "dealing") {
      room.dealNextAutomaticCard();
    }
    room.settleAutomaticRound();
    room.startAutomaticRound();
    await room.placeAutomaticPlayerBets(signal);

    resolveOldDecision(originalDecision);
    await oldRoundBetting;

    const firstAiActorId = room
      .getSnapshot()
      .seats.find((seat) => seat.occupantId?.includes("-ai-1"))
      ?.occupantId;
    const firstAiBetEvents = store
      .listByTable(tableId)
      .filter(
        (event) =>
          event.intent?.type === "place_bet" &&
          event.actorId === firstAiActorId &&
          event.actorId !== humanActorId,
      );
    expect(firstAiBetEvents).toHaveLength(0);
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

  it("reports a scheduled store append failure after the room faults", async () => {
    const backingStore = new MemoryEventStore();
    let failNextAppend = false;
    const appendError = new Error("scheduled append failed");
    const store: EventStore = {
      append: (event) => {
        if (failNextAppend) {
          failNextAppend = false;
          throw appendError;
        }
        backingStore.append(event);
      },
      listByTable: (tableId) => backingStore.listByTable(tableId),
      count: () => backingStore.count(),
    };
    const tableId = asTableId("scheduler-store-fault-table");
    const roomManager = new RoomManager(store);
    const room = roomManager.createRoom({
      tableId,
      rulePack: createRulePack(),
      humanActorId: asActorId("scheduler-store-fault-human"),
      joinCredential: "scheduler-credential",
      seatCount: 3,
      aiCount: 2,
      shoeSeed: "scheduler-store-fault-seed",
    });
    const onError = vi.fn();
    const scheduler = new AutomaticRoundScheduler(room, TIMING, { onError });

    scheduler.start();
    await advance(0);
    failNextAppend = true;
    await advance(TIMING.bettingWindowMs);
    await advance(100_000);

    expect(room.isFaulted()).toBe(true);
    expect(scheduler.isRunning()).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ rootCause: appendError }),
    );
  });

  it("does not start a faulted room and reports the condition", () => {
    const onError = vi.fn();
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn(),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "shoe_ready"),
      isFaulted: vi.fn(() => true),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING, { onError });

    scheduler.start();

    expect(scheduler.isRunning()).toBe(false);
    expect(room.startAutomaticRound).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("preserves the remaining betting window across stop and start", async () => {
    const { room, store, tableId } = createRealRoom();
    const eightSecondTiming = { ...TIMING, bettingWindowMs: 8_000 };
    const scheduler = new AutomaticRoundScheduler(room, eightSecondTiming);
    scheduler.start();
    await advance(7_000);
    scheduler.stop();

    scheduler.start();
    await advance(999);
    expect(room.getSnapshot().phase).toBe("round_betting");
    await advance(1);
    expect(room.getSnapshot().phase).toBe("no_more_bets");

    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }
    expectNoRejectedStartRound(store, tableId);
  });

  it("closes betting immediately when its preserved deadline has expired", async () => {
    const { room } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    scheduler.start();
    await advance(TIMING.bettingWindowMs - 100);
    scheduler.stop();

    await advance(200);
    scheduler.start();
    await advance(0);

    expect(room.getSnapshot().phase).toBe("no_more_bets");
  });

  it("preserves the remaining round-end display delay across stop and start", async () => {
    let phase: ReturnType<AutomaticRoundRoom["getAutomaticRoundPhase"]> =
      "settling";
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(() => {
        phase = "round_betting";
      }),
      placeAutomaticPlayerBets: vi.fn(),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(() => {
        phase = "round_end";
      }),
      getAutomaticRoundPhase: vi.fn(() => phase),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    scheduler.start();
    await advance(0);
    await advance(TIMING.settlementDisplayMs + TIMING.interRoundDelayMs - 100);
    scheduler.stop();

    scheduler.start();
    await advance(99);
    expect(room.startAutomaticRound).not.toHaveBeenCalled();
    await advance(1);
    expect(room.startAutomaticRound).toHaveBeenCalledOnce();
  });

  it("waits a complete configured delay when first attached in round_end", async () => {
    const room: AutomaticRoundRoom = {
      startAutomaticRound: vi.fn(),
      placeAutomaticPlayerBets: vi.fn(),
      closeAutomaticBetting: vi.fn(),
      dealNextAutomaticCard: vi.fn(),
      settleAutomaticRound: vi.fn(),
      getAutomaticRoundPhase: vi.fn(() => "round_end"),
      isFaulted: vi.fn(() => false),
    };
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    await advance(TIMING.settlementDisplayMs + TIMING.interRoundDelayMs - 1);
    expect(room.startAutomaticRound).not.toHaveBeenCalled();
    await advance(1);
    expect(room.startAutomaticRound).toHaveBeenCalledOnce();
  });

  it("resumes a real room in dealing and completes the current round", async () => {
    const { room, store, tableId } = createRealRoom();
    const scheduler = new AutomaticRoundScheduler(room, TIMING);
    scheduler.start();
    await advance(TIMING.bettingWindowMs + TIMING.cardDealIntervalMs);
    expect(room.getSnapshot().phase).toBe("dealing");
    scheduler.stop();

    scheduler.start();
    while (room.getSnapshot().phase !== "round_end") {
      await advance(TIMING.cardDealIntervalMs);
    }

    expect(room.getSnapshot().outcome).not.toBeNull();
    expectNoRejectedStartRound(store, tableId);
  });

  it("resumes a real room in settling and completes the current round", async () => {
    const { room, store, tableId } = createRealRoom();
    room.startAutomaticRound();
    room.closeAutomaticBetting();
    do {
      room.dealNextAutomaticCard();
    } while (room.getSnapshot().phase === "dealing");
    expect(room.getSnapshot().phase).toBe("settling");
    const scheduler = new AutomaticRoundScheduler(room, TIMING);

    scheduler.start();
    scheduler.stop();
    scheduler.start();
    await advance(0);

    expect(room.getSnapshot().phase).toBe("round_end");
    expect(room.getSnapshot().outcome).not.toBeNull();
    expectNoRejectedStartRound(store, tableId);
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
