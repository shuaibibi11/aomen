/**
 * Bet kinds available at a baccarat table.
 *
 * The main bets are player, banker and tie. Side bets in this phase are limited
 * to player_pair and banker_pair per the plan; the enum is left open for later
 * rule packs to extend without a breaking change.
 */
export const BET_KINDS = [
  "player",
  "banker",
  "tie",
  "player_pair",
  "banker_pair",
] as const;

export type BetKind = (typeof BET_KINDS)[number];

/** The three main outcomes a round settles to. */
export type RoundOutcome = "player" | "banker" | "tie";
