/**
 * Training-chip ledger.
 *
 * The ledger owns every seat's chip stack at one table. Chips are training-only
 * and carry no cash value; the ledger just tracks integer balances and enforces
 * one invariant: a seat can never wager more than it holds.
 *
 * Each seat has two balances:
 *   stack  → chips free to bet or cash out
 *   locked → chips committed to open bets this round
 *
 * A bet moves chips from stack to locked. Settlement clears the locked amount
 * and returns the payout (stake included) to the stack, so a push restores the
 * stake, a loss returns nothing, and a win returns stake plus winnings.
 */
import type { SeatId } from "@mct/shared";

interface SeatBalance {
  stack: number;
  locked: number;
}

export class ChipLedger {
  private readonly balances = new Map<SeatId, SeatBalance>();

  /** Get or create the balance record for a seat. */
  private balanceFor(seatId: SeatId): SeatBalance {
    let balance = this.balances.get(seatId);
    if (balance === undefined) {
      balance = { stack: 0, locked: 0 };
      this.balances.set(seatId, balance);
    }
    return balance;
  }

  /** Chips a seat has free to bet or cash out. */
  getStack(seatId: SeatId): number {
    return this.balances.get(seatId)?.stack ?? 0;
  }

  /** Chips a seat has committed to open bets this round. */
  getLocked(seatId: SeatId): number {
    return this.balances.get(seatId)?.locked ?? 0;
  }

  /** Whether a buy-in would preserve a positive safe-integer stack. */
  canBuyIn(seatId: SeatId, amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return false;
    }
    const resultingStack = this.getStack(seatId) + amount;
    return Number.isSafeInteger(resultingStack);
  }

  /** Add a buy-in to a seat's stack. */
  buyIn(seatId: SeatId, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`buyIn amount must be a positive safe integer, got ${amount}`);
    }
    if (!this.canBuyIn(seatId, amount)) {
      const resultingStack = this.getStack(seatId) + amount;
      throw new Error(`buyIn resulting stack must be a safe integer, got ${resultingStack}`);
    }
    const balance = this.balanceFor(seatId);
    const resultingStack = balance.stack + amount;
    balance.stack = resultingStack;
  }

  /**
   * Try to lock a bet from a seat's stack. Returns false and changes nothing if
   * the seat cannot cover it, so a caller can reject the bet cleanly.
   */
  tryLockBet(seatId: SeatId, amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`bet amount must be a positive safe integer, got ${amount}`);
    }
    const balance = this.balanceFor(seatId);
    if (balance.stack < amount) {
      return false;
    }
    const resultingStack = balance.stack - amount;
    const resultingLocked = balance.locked + amount;
    if (!Number.isSafeInteger(resultingStack) || !Number.isSafeInteger(resultingLocked)) {
      return false;
    }
    balance.stack = resultingStack;
    balance.locked = resultingLocked;
    return true;
  }

  /** Whether applying a payout would preserve a non-negative safe stack. */
  canApplyPayout(seatId: SeatId, payout: number): boolean {
    if (!Number.isSafeInteger(payout) || payout < 0) {
      return false;
    }
    const resultingStack = this.getStack(seatId) + payout;
    return Number.isSafeInteger(resultingStack) && resultingStack >= 0;
  }

  /**
   * Settle a seat's open bets: clear the locked amount and return `payout` to
   * the stack. `payout` is the total returned to the player (stake included),
   * so 0 is a full loss, the stake is a push, and more than the stake is a win.
   */
  applyPayout(seatId: SeatId, payout: number): void {
    if (!Number.isSafeInteger(payout) || payout < 0) {
      throw new Error(`payout must be a non-negative safe integer, got ${payout}`);
    }
    const balance = this.balanceFor(seatId);
    const resultingStack = balance.stack + payout;
    if (!Number.isSafeInteger(resultingStack)) {
      throw new Error(`payout resulting stack must be a safe integer, got ${resultingStack}`);
    }
    balance.locked = 0;
    balance.stack = resultingStack;
  }

  /**
   * Cash out a seat's free stack and return it. Chips locked in an open bet are
   * left in play, so cashing out mid-round only releases what is not at risk.
   */
  cashOut(seatId: SeatId): number {
    const balance = this.balanceFor(seatId);
    const freed = balance.stack;
    balance.stack = 0;
    return freed;
  }
}
