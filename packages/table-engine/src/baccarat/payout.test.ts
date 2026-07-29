/**
 * Payout tests.
 *
 * Payouts are house rules, so they come from the rule pack rather than being
 * hard-coded. These tests lock the four cases a trainee must never see wrong:
 * player 1:1, standard banker 1:1 minus 5% commission, no-commission banker
 * (with the banker-six half payout), and a tie pushing the main bets.
 *
 * The payout is expressed as the total amount returned to the player, including
 * their stake: a lost bet returns 0, a push returns the stake, and a win
 * returns the stake plus winnings.
 */
import { describe, expect, it } from "vitest";
import type { RulePack } from "@mct/rule-packs";
import {
  computeMainBetPayout,
  computeSideBetPayout,
  isBetAmountSettlementSafe,
} from "./payout.js";

/** Standard 5%-commission pack. */
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

/** No-commission pack: banker wins 1:1 except a banker-six pays 1:2. */
function noCommissionPack(): RulePack {
  return {
    ...standardPack(),
    id: "nocomm",
    variant: "no_commission",
    mainPayouts: { player: 1, banker: 1, tie: 8, bankerSixPayout: 0.5 },
  };
}

describe("computeMainBetPayout — player bet", () => {
  it("pays 1:1 on a player win", () => {
    const result = computeMainBetPayout("player", 100, "player", standardPack(), 5);
    expect(result.won).toBe(true);
    expect(result.push).toBe(false);
    expect(result.payout).toBe(200);
  });

  it("loses on a banker win", () => {
    const result = computeMainBetPayout("player", 100, "banker", standardPack(), 5);
    expect(result.won).toBe(false);
    expect(result.payout).toBe(0);
  });

  it("pushes on a tie", () => {
    const result = computeMainBetPayout("player", 100, "tie", standardPack(), 5);
    expect(result.push).toBe(true);
    expect(result.payout).toBe(100);
  });
});

describe("computeMainBetPayout — standard banker bet", () => {
  it("pays 1:1 minus 5% commission on a banker win", () => {
    const result = computeMainBetPayout("banker", 100, "banker", standardPack(), 7);
    expect(result.won).toBe(true);
    // Stake 100 + winnings 100 * 0.95 = 195.
    expect(result.payout).toBe(195);
  });

  it("charges commission regardless of the banker total", () => {
    const onSix = computeMainBetPayout("banker", 100, "banker", standardPack(), 6);
    // Standard rules do not treat a banker six specially.
    expect(onSix.payout).toBe(195);
  });

  it("loses on a player win", () => {
    const result = computeMainBetPayout("banker", 100, "player", standardPack(), 7);
    expect(result.payout).toBe(0);
  });

  it("pushes on a tie", () => {
    const result = computeMainBetPayout("banker", 100, "tie", standardPack(), 7);
    expect(result.push).toBe(true);
    expect(result.payout).toBe(100);
  });
});

describe("computeMainBetPayout — no-commission banker bet", () => {
  it("pays 1:1 on a banker win that is not a six", () => {
    const result = computeMainBetPayout("banker", 100, "banker", noCommissionPack(), 7);
    expect(result.payout).toBe(200);
  });

  it("pays only 1:2 on a banker win with a total of six", () => {
    const result = computeMainBetPayout("banker", 100, "banker", noCommissionPack(), 6);
    // Stake 100 + winnings 100 * 0.5 = 150.
    expect(result.payout).toBe(150);
  });
});

describe("computeMainBetPayout — tie bet", () => {
  it("pays 8:1 on a tie", () => {
    const result = computeMainBetPayout("tie", 100, "tie", standardPack(), 0);
    expect(result.won).toBe(true);
    expect(result.payout).toBe(900);
  });

  it("loses when the round is not a tie", () => {
    const result = computeMainBetPayout("tie", 100, "banker", standardPack(), 7);
    expect(result.payout).toBe(0);
  });
});

describe("computeSideBetPayout — pair bets", () => {
  it("pays 11:1 when the player's first two cards are a pair", () => {
    const result = computeSideBetPayout("player_pair", 100, true, standardPack());
    expect(result.won).toBe(true);
    expect(result.payout).toBe(1200);
  });

  it("loses when there is no player pair", () => {
    const result = computeSideBetPayout("player_pair", 100, false, standardPack());
    expect(result.payout).toBe(0);
  });

  it("pays 11:1 when the banker's first two cards are a pair", () => {
    const result = computeSideBetPayout("banker_pair", 100, true, standardPack());
    expect(result.payout).toBe(1200);
  });

  it("throws when the pack does not offer that side bet", () => {
    const pack = standardPack();
    pack.sideBets = [];
    expect(() => computeSideBetPayout("player_pair", 100, true, pack)).toThrow();
  });
});

describe("isBetAmountSettlementSafe", () => {
  it("accepts a standard banker stake whose commissioned payout is integral", () => {
    expect(isBetAmountSettlementSafe("banker", 100, standardPack())).toBe(true);
  });

  it("rejects a standard banker stake whose commissioned payout is fractional", () => {
    expect(isBetAmountSettlementSafe("banker", 101, standardPack())).toBe(false);
  });

  it("rejects a no-commission banker stake that can settle fractionally on banker six", () => {
    expect(isBetAmountSettlementSafe("banker", 101, noCommissionPack())).toBe(false);
  });

  it("accepts configured side bets and rejects unavailable side bets", () => {
    const pack = standardPack();
    expect(isBetAmountSettlementSafe("player_pair", 100, pack)).toBe(true);
    pack.sideBets = [];
    expect(isBetAmountSettlementSafe("player_pair", 100, pack)).toBe(false);
  });
});
