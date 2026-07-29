/**
 * Chip ledger tests.
 *
 * The ledger owns every training-chip stack at a table. It must never let a
 * seat wager more than it holds, and every movement — buy-in, locked bet,
 * payout, cash-out — has to leave the stack consistent. These are the invariants
 * a trainee's balance depends on, so they are locked here.
 *
 * Chips are training-only and have no cash value; the ledger just tracks
 * integers.
 */
import { describe, expect, it } from "vitest";
import { asSeatId } from "@mct/shared";
import { ChipLedger } from "./chip-ledger.js";

const SEAT_1 = asSeatId("seat-1");
const SEAT_2 = asSeatId("seat-2");

describe("ChipLedger buy-in", () => {
  it("starts a seat with no stack", () => {
    const ledger = new ChipLedger();
    expect(ledger.getStack(SEAT_1)).toBe(0);
  });

  it("adds a buy-in to the stack", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    expect(ledger.getStack(SEAT_1)).toBe(1000);
  });

  it("accumulates repeated buy-ins", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    ledger.buyIn(SEAT_1, 500);
    expect(ledger.getStack(SEAT_1)).toBe(1500);
  });

  it("reports whether a buy-in preserves a positive safe-integer stack", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, Number.MAX_SAFE_INTEGER - 1);

    expect(ledger.canBuyIn(SEAT_1, 1)).toBe(true);
    expect(ledger.canBuyIn(SEAT_1, 2)).toBe(false);
    expect(ledger.canBuyIn(SEAT_1, 0)).toBe(false);
    expect(ledger.canBuyIn(SEAT_1, 1.5)).toBe(false);
  });

  it("rejects a buy-in that would overflow the accumulated stack", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, Number.MAX_SAFE_INTEGER);

    expect(() => ledger.buyIn(SEAT_1, 1)).toThrow(/safe integer/);
    expect(ledger.getStack(SEAT_1)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects a non-positive buy-in", () => {
    const ledger = new ChipLedger();
    expect(() => ledger.buyIn(SEAT_1, 0)).toThrow();
    expect(() => ledger.buyIn(SEAT_1, -100)).toThrow();
  });

  it("keeps seats independent", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    expect(ledger.getStack(SEAT_2)).toBe(0);
  });
});

describe("ChipLedger locking bets", () => {
  it("moves chips out of the stack when a bet is locked", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    const locked = ledger.tryLockBet(SEAT_1, 300);
    expect(locked).toBe(true);
    expect(ledger.getStack(SEAT_1)).toBe(700);
  });

  it("refuses a bet larger than the stack and leaves it untouched", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 200);
    const locked = ledger.tryLockBet(SEAT_1, 300);
    expect(locked).toBe(false);
    expect(ledger.getStack(SEAT_1)).toBe(200);
  });

  it("allows locking the entire stack", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 500);
    expect(ledger.tryLockBet(SEAT_1, 500)).toBe(true);
    expect(ledger.getStack(SEAT_1)).toBe(0);
  });

  it("tracks total locked across several bets", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    ledger.tryLockBet(SEAT_1, 300);
    ledger.tryLockBet(SEAT_1, 200);
    expect(ledger.getLocked(SEAT_1)).toBe(500);
    expect(ledger.getStack(SEAT_1)).toBe(500);
  });

  it("rejects a non-positive bet", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    expect(() => ledger.tryLockBet(SEAT_1, 0)).toThrow();
  });
});

describe("ChipLedger applying payouts", () => {
  it("returns the payout to the stack and clears the locked amount", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    ledger.tryLockBet(SEAT_1, 300);
    // A player win pays 600 back (300 stake + 300 winnings).
    ledger.applyPayout(SEAT_1, 600);
    expect(ledger.getStack(SEAT_1)).toBe(1300);
    expect(ledger.getLocked(SEAT_1)).toBe(0);
  });

  it("adds nothing for a lost bet but still clears the lock", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    ledger.tryLockBet(SEAT_1, 300);
    ledger.applyPayout(SEAT_1, 0);
    expect(ledger.getStack(SEAT_1)).toBe(700);
    expect(ledger.getLocked(SEAT_1)).toBe(0);
  });

  it("returns the stake for a push", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    ledger.tryLockBet(SEAT_1, 300);
    ledger.applyPayout(SEAT_1, 300);
    expect(ledger.getStack(SEAT_1)).toBe(1000);
    expect(ledger.getLocked(SEAT_1)).toBe(0);
  });

  it("reports and rejects a payout that would overflow without changing balances", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, Number.MAX_SAFE_INTEGER);

    expect(ledger.canApplyPayout(SEAT_1, 0)).toBe(true);
    expect(ledger.canApplyPayout(SEAT_1, 1)).toBe(false);
    expect(() => ledger.applyPayout(SEAT_1, 1)).toThrow(/safe integer/);
    expect(ledger.getStack(SEAT_1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ledger.getLocked(SEAT_1)).toBe(0);
  });
});

describe("ChipLedger cash-out", () => {
  it("returns the stack and empties the seat", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    const cashed = ledger.cashOut(SEAT_1);
    expect(cashed).toBe(1000);
    expect(ledger.getStack(SEAT_1)).toBe(0);
  });

  it("does not return chips that are locked in an open bet", () => {
    const ledger = new ChipLedger();
    ledger.buyIn(SEAT_1, 1000);
    ledger.tryLockBet(SEAT_1, 300);
    // Only the free stack cashes out; the locked 300 is still in play.
    const cashed = ledger.cashOut(SEAT_1);
    expect(cashed).toBe(700);
    expect(ledger.getLocked(SEAT_1)).toBe(300);
  });
});
