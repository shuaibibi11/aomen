import type { BetKind } from "@mct/shared";
import type { PlayerDecisionContext } from "./player-decision-context.js";

export interface PlayerBetDecision {
  readonly betKind: BetKind;
  readonly amount: number;
}

/** Chooses a candidate wager without knowing room actor or seat identities. */
export interface PlayerDecisionSource {
  decideBet(
    context: PlayerDecisionContext,
    signal: AbortSignal,
  ): Promise<PlayerBetDecision | null>;
}
