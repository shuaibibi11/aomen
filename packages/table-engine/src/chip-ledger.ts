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

  /** Add a buy-in to a seat's stack. */
  buyIn(seatId: SeatId, amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`buyIn amount must be a positive integer, got ${amount}`);
    }
    this.balanceFor(seatId).stack += amount;
  }

  /**
   * Try to lock a bet from a seat's stack. Returns false and changes nothing if
   * the seat cannot cover it, so a caller can reject the bet cleanly.
   */
  tryLockBet(seatId: SeatId, amount: number): boolean {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`bet amount must be a positive integer, got ${amount}`);
    }
    const balance = this.balanceFor(seatId);
    if (balance.stack < amount) {
      return false;
    }
    balance.stack -= amount;
    balance.locked += amount;
    return true;
  }

  /**
   * Settle a seat's open bets: clear the locked amount and return `payout` to
   * the stack. `payout` is the total returned to the player (stake included),
   * so 0 is a full loss, the stake is a push, and more than the stake is a win.
   */
  applyPayout(seatId: SeatId, payout: number): void {
    if (!Number.isInteger(payout) || payout < 0) {
      throw new Error(`payout must be a non-negative integer, got ${payout}`);
    }
    const balance = this.balanceFor(seatId);
    balance.locked = 0;
    balance.stack += payout;
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
