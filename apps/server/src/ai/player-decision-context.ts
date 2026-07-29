import type { BetKind, RoundOutcome, TablePhase } from "@mct/shared";

export interface PublicBetTotal {
  readonly betKind: BetKind;
  readonly amount: number;
}

export interface PublicPlayerHistorySummary {
  readonly completedRounds: number;
  readonly recentOutcomes: readonly RoundOutcome[];
  readonly currentBetTotals: readonly PublicBetTotal[];
}

/** Public, identity-free table information required to choose a wager. */
export interface PlayerDecisionContext {
  readonly phase: TablePhase;
  readonly round: string;
  readonly stack: number;
  readonly allowedBetKinds: readonly BetKind[];
  readonly limits: {
    readonly min: number;
    readonly max: number;
  };
  readonly publicHistory: PublicPlayerHistorySummary;
}
