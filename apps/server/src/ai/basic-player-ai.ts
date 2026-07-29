/**
 * Basic AI player.
 *
 * Fills an empty seat so a trainee is not alone at the table. Its only job in
 * this phase is to place a small, legal bet during the betting phase: it picks
 * player or banker and stakes the table minimum. It is intentionally simple —
 * personas and traps are a later phase.
 */
import type { RulePack } from "@mct/rule-packs";
import { createSeededRng, type SeededRng } from "@mct/table-engine";
import type { PlayerDecisionContext } from "./player-decision-context.js";
import type {
  PlayerBetDecision,
  PlayerDecisionSource,
} from "./player-decision-source.js";

export interface BasicPlayerAiOptions {
  readonly rulePack: RulePack;
  /** Seed so a session's AI decisions are reproducible for replay. */
  readonly seed: string;
}

/**
 * A basic AI seat occupant. `decideBet` returns a place-bet intent, or null if
 * the AI chooses to sit out this round.
 */
export class BasicPlayerAi implements PlayerDecisionSource {
  private readonly rulePack: RulePack;
  private readonly rng: SeededRng;

  constructor(options: BasicPlayerAiOptions) {
    this.rulePack = options.rulePack;
    this.rng = createSeededRng(options.seed);
  }

  /**
   * Decide a bet for the current betting phase. Stakes the table minimum on a
   * randomly chosen player or banker bet, which is always a legal wager if the
   * seat has been funded to the minimum.
   */
  async decideBet(
    _context: PlayerDecisionContext,
    signal: AbortSignal,
  ): Promise<PlayerBetDecision | null> {
    if (signal.aborted) {
      return null;
    }
    const betKind = this.rng.nextFloat() < 0.5 ? "player" : "banker";
    return {
      betKind,
      amount: this.rulePack.limits.min,
    };
  }
}
