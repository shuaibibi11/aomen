import { describe, expect, it } from "vitest";
import type { RulePack } from "@mct/rule-packs";
import { BasicPlayerAi } from "./basic-player-ai.js";
import type { PlayerDecisionContext } from "./player-decision-context.js";

function createRulePack(): RulePack {
  return {
    id: "std",
    version: "1.0.0",
    displayName: "Standard",
    variant: "standard",
    limits: { min: 100, max: 10_000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100] },
  };
}

function createContext(): PlayerDecisionContext {
  return {
    phase: "round_betting",
    round: "round-1",
    stack: 5_000,
    allowedBetKinds: ["player", "banker", "tie"],
    limits: { min: 100, max: 10_000 },
    publicHistory: {
      completedRounds: 0,
      recentOutcomes: [],
      currentBetTotals: [],
    },
  };
}

describe("BasicPlayerAi", () => {
  it("returns the same identity-free decision for the same seed", async () => {
    const firstAi = new BasicPlayerAi({ rulePack: createRulePack(), seed: "stable-seed" });
    const secondAi = new BasicPlayerAi({ rulePack: createRulePack(), seed: "stable-seed" });

    const firstDecision = await firstAi.decideBet(
      createContext(),
      new AbortController().signal,
    );
    const secondDecision = await secondAi.decideBet(
      createContext(),
      new AbortController().signal,
    );

    expect(firstDecision).toEqual(secondDecision);
    expect(firstDecision).toEqual(
      expect.objectContaining({ amount: 100 }),
    );
    expect(firstDecision).not.toHaveProperty("actorId");
    expect(firstDecision).not.toHaveProperty("seatId");
  });

  it("sits out when the stack is below the table minimum", async () => {
    const ai = new BasicPlayerAi({ rulePack: createRulePack(), seed: "low-stack" });
    const context = { ...createContext(), stack: 99 };

    await expect(
      ai.decideBet(context, new AbortController().signal),
    ).resolves.toBeNull();
  });
});
