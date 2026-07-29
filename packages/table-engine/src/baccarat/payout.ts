/**
 * Baccarat payout computation.
 *
 * Payouts are house rules, so every figure here comes from the rule pack — the
 * engine never hard-codes a single casino's odds. A payout is expressed as the
 * total amount returned to the player, stake included:
 *
 *   lost bet  → 0
 *   push      → the stake back
 *   win       → the stake plus winnings
 *
 * The two variants differ only on a banker win:
 *   standard      → winnings are stake * bankerPayout, minus commission
 *   no_commission → winnings are stake * bankerPayout, except a banker win on a
 *                   total of 6 pays stake * bankerSixPayout
 */
import type { BetKind, RoundOutcome } from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";

/** The result of settling one bet. */
export interface PayoutResult {
  /** Whether the bet won (a push is neither a win nor a loss). */
  readonly won: boolean;
  /** Whether the bet pushed (stake returned, no winnings). */
  readonly push: boolean;
  /** Total returned to the player, including the stake. */
  readonly payout: number;
}

const LOST: PayoutResult = { won: false, push: false, payout: 0 };

function push(stake: number): PayoutResult {
  return { won: false, push: true, payout: stake };
}

function win(stake: number, winnings: number): PayoutResult {
  return { won: true, push: false, payout: stake + winnings };
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeSettlementForWinnings(stake: number, winnings: number): boolean {
  return isNonNegativeSafeInteger(winnings) && isNonNegativeSafeInteger(stake + winnings);
}

/**
 * Whether a bet can settle without fractional or unsafe chip arithmetic under
 * every payout path that the current rule pack can produce for that bet kind.
 */
export function isBetAmountSettlementSafe(
  betKind: BetKind,
  stake: number,
  pack: RulePack,
): boolean {
  if (!Number.isSafeInteger(stake) || stake <= 0) {
    return false;
  }

  if (betKind === "player") {
    return isSafeSettlementForWinnings(stake, stake * pack.mainPayouts.player);
  }
  if (betKind === "tie") {
    return isSafeSettlementForWinnings(stake, stake * pack.mainPayouts.tie);
  }
  if (betKind === "banker") {
    if (pack.variant === "no_commission") {
      const regularBankerWinnings = stake * pack.mainPayouts.banker;
      const bankerSixWinnings = stake * (pack.mainPayouts.bankerSixPayout ?? 0.5);
      return (
        isSafeSettlementForWinnings(stake, regularBankerWinnings) &&
        isSafeSettlementForWinnings(stake, bankerSixWinnings)
      );
    }
    const bankerWinningsAfterCommission =
      stake * pack.mainPayouts.banker * (1 - pack.commission.rate);
    return isSafeSettlementForWinnings(stake, bankerWinningsAfterCommission);
  }

  const sideBet = pack.sideBets.find((candidate) => candidate.kind === betKind);
  return sideBet !== undefined && isSafeSettlementForWinnings(stake, stake * sideBet.payout);
}

/**
 * Settle a main bet (player, banker or tie).
 *
 * @param betKind      which main bet was placed
 * @param stake        the amount wagered
 * @param outcome      the round outcome
 * @param pack         the active rule pack
 * @param bankerTotal  the banker's final total, needed for the no-commission
 *                     banker-six half payout
 */
export function computeMainBetPayout(
  betKind: "player" | "banker" | "tie",
  stake: number,
  outcome: RoundOutcome,
  pack: RulePack,
  bankerTotal: number,
): PayoutResult {
  if (betKind === "player") {
    if (outcome === "tie") {
      return push(stake);
    }
    if (outcome === "player") {
      return win(stake, stake * pack.mainPayouts.player);
    }
    return LOST;
  }

  if (betKind === "banker") {
    if (outcome === "tie") {
      return push(stake);
    }
    if (outcome !== "banker") {
      return LOST;
    }
    return computeBankerWin(stake, pack, bankerTotal);
  }

  // Tie bet: wins only on a tie, and does not push on player/banker.
  if (outcome === "tie") {
    return win(stake, stake * pack.mainPayouts.tie);
  }
  return LOST;
}

/** Winnings for a banker win, applying the pack's commission variant. */
function computeBankerWin(
  stake: number,
  pack: RulePack,
  bankerTotal: number,
): PayoutResult {
  if (pack.variant === "no_commission") {
    // A banker win on 6 pays the reduced rate; every other banker win is full.
    const isBankerSix = bankerTotal === 6;
    const sixPayout = pack.mainPayouts.bankerSixPayout ?? 0.5;
    const rate = isBankerSix ? sixPayout : pack.mainPayouts.banker;
    return win(stake, stake * rate);
  }

  // Standard: full banker payout minus commission on the winnings.
  const grossWinnings = stake * pack.mainPayouts.banker;
  const netWinnings = grossWinnings * (1 - pack.commission.rate);
  return win(stake, netWinnings);
}

/**
 * Settle a pair side bet.
 *
 * @param betKind    "player_pair" or "banker_pair"
 * @param stake      the amount wagered
 * @param isPair     whether that side's first two cards formed a pair
 * @param pack       the active rule pack
 *
 * Throws if the pack does not offer the requested side bet, so a bet that
 * should never have been accepted fails loudly rather than paying a guessed
 * price.
 */
export function computeSideBetPayout(
  betKind: "player_pair" | "banker_pair",
  stake: number,
  isPair: boolean,
  pack: RulePack,
): PayoutResult {
  const sideBet = pack.sideBets.find((candidate) => candidate.kind === betKind);
  if (sideBet === undefined) {
    throw new Error(`Rule pack does not offer side bet: ${betKind}`);
  }
  if (!isPair) {
    return LOST;
  }
  return win(stake, stake * sideBet.payout);
}

/** Narrow a BetKind to a main bet, for callers dispatching on bet kind. */
export function isMainBet(
  betKind: BetKind,
): betKind is "player" | "banker" | "tie" {
  return betKind === "player" || betKind === "banker" || betKind === "tie";
}
