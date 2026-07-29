/**
 * TableRuntime tests.
 *
 * The runtime is the state machine that ties the draw table, payouts and chip
 * ledger into one round: bet, deal, settle. These tests drive a full round with
 * a predetermined card sequence (injected via `drawCard`) so the outcome is
 * exact, then assert the outcome, the ledger, and the event log.
 *
 * The deal path must consult the real draw table — isNatural, playerDrawsThird,
 * bankerDrawsThird — rather than stopping at two cards, so the card sequences
 * below are chosen to exercise the third-card rules.
 */
import { describe, expect, it } from "vitest";
import {
  asActorId,
  asSeatId,
  asTableId,
  type Card,
  type Rank,
  type Suit,
  type TableIntent,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import { TableRuntime } from "./table-runtime.js";

function c(rank: Rank, suit: Suit = "spade"): Card {
  return { rank, suit };
}

/** Deal cards from a fixed queue so a round plays out deterministically. */
function queueDrawer(cards: readonly Card[]): () => Card {
  let index = 0;
  return () => {
    const card = cards[index];
    if (card === undefined) {
      throw new Error("queueDrawer exhausted");
    }
    index += 1;
    return card;
  };
}

function standardPack(): RulePack {
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

function noCommissionPack(): RulePack {
  return {
    ...standardPack(),
    id: "nocomm",
    variant: "no_commission",
    mainPayouts: { player: 1, banker: 1, tie: 8, bankerSixPayout: 0.5 },
  };
}

const TABLE_ID = asTableId("table-1");
const DEALER = asActorId("dealer");
const ALICE = asActorId("alice");
const BOB = asActorId("bob");
const SEAT_1 = asSeatId("seat-1");
const SEAT_2 = asSeatId("seat-2");

interface RuntimeSetup {
  readonly pack?: RulePack;
  readonly cards: readonly Card[];
}

function makeRuntime(setup: RuntimeSetup): TableRuntime {
  return new TableRuntime({
    tableId: TABLE_ID,
    rulePack: setup.pack ?? standardPack(),
    dealerId: DEALER,
    seatIds: [SEAT_1],
    drawCard: queueDrawer(setup.cards),
    now: () => 0,
  });
}

/** Deal until the runtime leaves the dealing phase. */
function dealToSettling(runtime: TableRuntime): void {
  let guard = 0;
  while (runtime.getSnapshot().phase === "dealing") {
    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    guard += 1;
    if (guard > 12) {
      throw new Error("deal did not reach settling");
    }
  }
}

describe("TableRuntime full round", () => {
  it("runs bet → deal → settle to a player win and pays 1:1", () => {
    // Player 2,3 (=5) draws 4 (=9). Banker 3,3 (=6) stands vs player third 4.
    const runtime = makeRuntime({
      cards: [c("2"), c("3"), c("3", "heart"), c("3", "diamond"), c("4")],
    });

    expect(runtime.getSnapshot().phase).toBe("shoe_ready");

    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    expect(runtime.getStack(SEAT_1)).toBe(1000);

    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    expect(runtime.getSnapshot().phase).toBe("round_betting");

    const betEvent = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 100,
    });
    expect(betEvent.accepted).toBe(true);
    expect(runtime.getStack(SEAT_1)).toBe(900);

    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });
    expect(runtime.getSnapshot().phase).toBe("no_more_bets");

    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    expect(runtime.getSnapshot().phase).toBe("dealing");
    dealToSettling(runtime);

    const snapshotBeforeSettle = runtime.getSnapshot();
    expect(snapshotBeforeSettle.hands.playerTotal).toBe(9);
    expect(snapshotBeforeSettle.hands.bankerTotal).toBe(6);

    const settleEvent = runtime.submitIntent({ type: "settle_round", actorId: DEALER });
    expect(settleEvent.accepted).toBe(true);
    expect(settleEvent.outcome).toBe("player");

    const finalSnapshot = runtime.getSnapshot();
    expect(finalSnapshot.phase).toBe("round_end");
    expect(finalSnapshot.outcome).toBe("player");
    // Stake 100 returned plus 100 winnings on a 900 remaining stack.
    expect(runtime.getStack(SEAT_1)).toBe(1100);
  });

  it("assigns strictly increasing event sequence numbers", () => {
    const runtime = makeRuntime({
      cards: [c("2"), c("3"), c("3", "heart"), c("3", "diamond"), c("4")],
    });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "place_bet", actorId: ALICE, seatId: SEAT_1, betKind: "player", amount: 100 });

    const sequences = runtime.getEvents().map((event) => event.seq);
    const ascending = [...sequences].sort((left, right) => left - right);
    expect(sequences).toEqual(ascending);
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});

describe("TableRuntime naturals", () => {
  it("ends the deal with no third card when a hand is natural", () => {
    // Player 9,K (=9) natural; banker 2,3 (=5). No third cards drawn.
    const runtime = makeRuntime({
      cards: [c("9"), c("2"), c("K"), c("3")],
    });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "place_bet", actorId: ALICE, seatId: SEAT_1, betKind: "player", amount: 100 });
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });
    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    dealToSettling(runtime);

    const snapshot = runtime.getSnapshot();
    expect(snapshot.hands.player).toHaveLength(2);
    expect(snapshot.hands.banker).toHaveLength(2);
    expect(snapshot.hands.playerTotal).toBe(9);
  });
});

describe("TableRuntime authorisation", () => {
  it("rejects an overflowing buy-in without replacing the occupant or changing the stack", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({
      type: "buy_in",
      actorId: ALICE,
      seatId: SEAT_1,
      amount: Number.MAX_SAFE_INTEGER,
    });

    const rejected = runtime.submitIntent({
      type: "buy_in",
      actorId: BOB,
      seatId: SEAT_1,
      amount: 1,
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("invalid_chip_amount");
    expect(runtime.getSnapshot().seats[0]).toEqual({
      seatId: SEAT_1,
      occupantId: ALICE,
      stack: Number.MAX_SAFE_INTEGER,
    });
    expect(runtime.getEvents()).toContainEqual(rejected);
  });

  it("rejects a fractional buy-in without replacing the occupant or changing the stack", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });

    const rejected = runtime.submitIntent({
      type: "buy_in",
      actorId: BOB,
      seatId: SEAT_1,
      amount: 1.5,
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("invalid_chip_amount");
    expect(runtime.getSnapshot().seats[0]).toEqual({
      seatId: SEAT_1,
      occupantId: ALICE,
      stack: 1000,
    });
    expect(runtime.getEvents()).toContainEqual(rejected);
  });

  it("rejects an unknown bet kind without locking chips or recording a bet", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    const snapshotBefore = runtime.getSnapshot();
    const untrustedIntent = {
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "dragon",
      amount: 100,
    } as unknown as TableIntent;

    const rejected = runtime.submitIntent(untrustedIntent);

    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("unknown_bet_kind");
    expect(runtime.getStack(SEAT_1)).toBe(1000);
    expect(runtime.getSnapshot().bets).toEqual(snapshotBefore.bets);
  });

  it("rejects a bet placed after betting is closed", () => {
    const runtime = makeRuntime({
      cards: [c("9"), c("2"), c("K"), c("3")],
    });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });

    const late = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 100,
    });
    expect(late.accepted).toBe(false);
    expect(late.rejectReason).toBe("wrong_phase");
    // The stack is untouched by a rejected bet.
    expect(runtime.getStack(SEAT_1)).toBe(1000);
  });

  it("rejects a non-dealer trying to close betting", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const rejected = runtime.submitIntent({ type: "no_more_bets", actorId: ALICE });
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("not_authorised");
    expect(runtime.getSnapshot().phase).toBe("round_betting");
  });

  it("rejects a bet on a seat the actor does not occupy", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const bob = asActorId("bob");
    const rejected = runtime.submitIntent({
      type: "place_bet",
      actorId: bob,
      seatId: SEAT_1,
      betKind: "player",
      amount: 100,
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("not_authorised");
  });

  it("rejects a bet below the table minimum", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const rejected = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 50,
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("bet_below_minimum");
  });

  it("rejects a bet the seat cannot fund", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 100 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const rejected = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 500,
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("insufficient_funds");
  });

  it("rejects unavailable side bets without locking chips or recording a bet", () => {
    const pack = standardPack();
    pack.sideBets = [];
    const runtime = makeRuntime({ pack, cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    const snapshotBefore = runtime.getSnapshot();

    const rejected = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player_pair",
      amount: 100,
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("bet_not_available");
    expect(runtime.getStack(SEAT_1)).toBe(1000);
    expect(runtime.getSnapshot().bets).toEqual(snapshotBefore.bets);
  });

  it("rejects unsafe bet amounts before locking chips or recording a bet", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    const snapshotBefore = runtime.getSnapshot();

    const rejected = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "banker",
      amount: 101,
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("invalid_bet_amount");
    expect(runtime.getStack(SEAT_1)).toBe(1000);
    expect(runtime.getSnapshot().bets).toEqual(snapshotBefore.bets);
  });

  it.each([0, -100, 100.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-positive or unsafe stake %s",
    (amount) => {
      const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
      runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
      runtime.submitIntent({ type: "start_round", actorId: DEALER });

      const rejected = runtime.submitIntent({
        type: "place_bet",
        actorId: ALICE,
        seatId: SEAT_1,
        betKind: "player",
        amount,
      });

      expect(rejected.accepted).toBe(false);
      expect(rejected.rejectReason).toBe("invalid_bet_amount");
      expect(runtime.getStack(SEAT_1)).toBe(1000);
      expect(runtime.getSnapshot().bets).toEqual([]);
    },
  );

  it("rejects a second individually safe bet when aggregate payout can overflow", () => {
    const firstPairStake = Math.floor(Number.MAX_SAFE_INTEGER / 12) - 100;
    const secondPairStake = 101;
    const pack = standardPack();
    pack.limits.max = firstPairStake;
    const runtime = makeRuntime({ pack, cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({
      type: "buy_in",
      actorId: ALICE,
      seatId: SEAT_1,
      amount: firstPairStake + secondPairStake,
    });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const first = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player_pair",
      amount: firstPairStake,
    });
    const stackBeforeSecondBet = runtime.getStack(SEAT_1);
    const second = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player_pair",
      amount: secondPairStake,
    });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.rejectReason).toBe("invalid_bet_amount");
    expect(runtime.getStack(SEAT_1)).toBe(stackBeforeSecondBet);
    expect(runtime.getSnapshot().bets).toHaveLength(1);
  });

  it("rejects a second bet when aggregate payout would overflow the final stack", () => {
    const pack = standardPack();
    pack.limits.max = 100;
    const runtime = makeRuntime({ pack, cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({
      type: "buy_in",
      actorId: ALICE,
      seatId: SEAT_1,
      amount: Number.MAX_SAFE_INTEGER - 150,
    });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    const first = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 100,
    });
    const stackBeforeSecondBet = runtime.getStack(SEAT_1);

    const second = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 100,
    });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.rejectReason).toBe("invalid_bet_amount");
    expect(runtime.getStack(SEAT_1)).toBe(stackBeforeSecondBet);
    expect(runtime.getSnapshot().bets).toHaveLength(1);
  });

  it("accepts normal multiple bets when every aggregate settlement is safe", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const playerBet = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player",
      amount: 100,
    });
    const tieBet = runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "tie",
      amount: 100,
    });

    expect(playerBet.accepted).toBe(true);
    expect(tieBet.accepted).toBe(true);
    expect(runtime.getStack(SEAT_1)).toBe(800);
    expect(runtime.getSnapshot().bets).toHaveLength(2);
  });
});

describe("TableRuntime no-commission banker six", () => {
  it("pays a banker win on six at 1:2", () => {
    // Player 3,2 (=5) draws K (=5). Banker 2,4 (=6) stands vs player third 0.
    const runtime = makeRuntime({
      pack: noCommissionPack(),
      cards: [c("3"), c("2"), c("2", "heart"), c("4"), c("K")],
    });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "place_bet", actorId: ALICE, seatId: SEAT_1, betKind: "banker", amount: 100 });
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });
    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    dealToSettling(runtime);

    const settle = runtime.submitIntent({ type: "settle_round", actorId: DEALER });
    expect(settle.outcome).toBe("banker");
    expect(runtime.getSnapshot().hands.bankerTotal).toBe(6);
    // 900 remaining + stake 100 + winnings 100 * 0.5 = 1050.
    expect(runtime.getStack(SEAT_1)).toBe(1050);
  });
});

describe("TableRuntime side bets", () => {
  it("pays a player pair at 11:1", () => {
    // Player 5,5 (pair, =0) draws 4 (=4). Banker 3,2 (=5) draws 2 (=7).
    const runtime = makeRuntime({
      cards: [c("5"), c("3"), c("5", "heart"), c("2"), c("4"), c("2", "heart")],
    });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({
      type: "place_bet",
      actorId: ALICE,
      seatId: SEAT_1,
      betKind: "player_pair",
      amount: 100,
    });
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });
    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    dealToSettling(runtime);
    runtime.submitIntent({ type: "settle_round", actorId: DEALER });

    // 900 remaining + stake 100 + winnings 100 * 11 = 2100.
    expect(runtime.getStack(SEAT_1)).toBe(2100);
  });

  it("does not partially settle any seat when a payout becomes unsafe", () => {
    const pack = standardPack();
    const runtime = new TableRuntime({
      tableId: TABLE_ID,
      rulePack: pack,
      dealerId: DEALER,
      seatIds: [SEAT_1, SEAT_2],
      drawCard: queueDrawer([c("5"), c("3"), c("5", "heart"), c("2"), c("4"), c("2", "heart")]),
      now: () => 0,
    });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 1000 });
    runtime.submitIntent({ type: "buy_in", actorId: BOB, seatId: SEAT_2, amount: 1000 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "place_bet", actorId: ALICE, seatId: SEAT_1, betKind: "player_pair", amount: 100 });
    runtime.submitIntent({ type: "place_bet", actorId: BOB, seatId: SEAT_2, betKind: "player_pair", amount: 100 });
    pack.sideBets = [{ kind: "player_pair", payout: Number.MAX_SAFE_INTEGER }];
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });
    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    dealToSettling(runtime);

    const snapshotBeforeSettlement = runtime.getSnapshot();
    const eventsBeforeSettlement = [...runtime.getEvents()];

    expect(() => runtime.submitIntent({ type: "settle_round", actorId: DEALER })).toThrow(
      /non-negative safe integer/,
    );
    expect(runtime.getStack(SEAT_1)).toBe(900);
    expect(runtime.getStack(SEAT_2)).toBe(900);
    expect(runtime.getSnapshot()).toEqual(snapshotBeforeSettlement);
    expect(runtime.getSnapshot().phase).toBe("settling");
    expect(runtime.getSnapshot().outcome).toBeNull();
    expect(runtime.getEvents()).toEqual(eventsBeforeSettlement);
  });
});

describe("TableRuntime buy-in phases", () => {
  it("accepts a buy-in in shoe_ready and again in round_end", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });

    const first = runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 500 });
    expect(first.accepted).toBe(true);

    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });
    runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    dealToSettling(runtime);
    runtime.submitIntent({ type: "settle_round", actorId: DEALER });
    expect(runtime.getSnapshot().phase).toBe("round_end");

    const second = runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 500 });
    expect(second.accepted).toBe(true);
    expect(runtime.getStack(SEAT_1)).toBe(1000);
  });

  it("rejects a buy-in while a round is being dealt", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 500 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });

    const rejected = runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 500 });
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectReason).toBe("wrong_phase");
  });
});

describe("TableRuntime reveal on deal when peek disabled", () => {
  it("reveals cards on the deal event when peeking is off", () => {
    const runtime = makeRuntime({ cards: [c("9"), c("2"), c("K"), c("3")] });
    runtime.submitIntent({ type: "buy_in", actorId: ALICE, seatId: SEAT_1, amount: 500 });
    runtime.submitIntent({ type: "start_round", actorId: DEALER });
    runtime.submitIntent({ type: "no_more_bets", actorId: DEALER });

    const firstDeal = runtime.submitIntent({ type: "deal_next", actorId: DEALER });
    expect(firstDeal.accepted).toBe(true);
    expect(firstDeal.cardsRevealed).toBeDefined();
    expect(firstDeal.cardsRevealed?.length).toBe(1);
  });
});
