/**
 * Rule-pack validation tests.
 *
 * These lock the schema's promises: a well-formed pack validates, and the two
 * failures most likely to slip through — max below min, and missing required
 * fields — are rejected loudly.
 */
import { describe, expect, it } from "vitest";
import { loadRulePack } from "./load.js";
import { RulePackValidationError, validateRulePack } from "./validate.js";
import type { RulePack } from "./schema.js";

/** A minimal valid pack, cloned per test so mutations do not leak. */
function validPackData(): Record<string, unknown> {
  return {
    id: "test-pack",
    version: "1.0.0",
    displayName: "Test Pack",
    variant: "standard",
    limits: { min: 100, max: 100000 },
    commission: { rate: 0.05 },
    mainPayouts: { player: 1, banker: 1, tie: 8 },
    sideBets: [{ kind: "player_pair", payout: 11 }],
    shoe: { deckCount: 8 },
    dealing: { peekAllowed: false },
    chipset: { currency: "HKD", denominations: [100, 1000] },
  };
}

describe("validateRulePack", () => {
  it("accepts a well-formed pack", () => {
    const pack = validateRulePack(validPackData());
    expect(pack.id).toBe("test-pack");
    expect(pack.variant).toBe("standard");
    expect(pack.limits.max).toBe(100000);
  });

  it("rejects a pack whose max is below its min", () => {
    const data = validPackData();
    data.limits = { min: 5000, max: 100 };
    expect(() => validateRulePack(data)).toThrow(RulePackValidationError);
  });

  it("rejects a pack missing a required field", () => {
    const data = validPackData();
    delete data.chipset;
    expect(() => validateRulePack(data)).toThrow(RulePackValidationError);
  });

  it("rejects an unknown commission variant", () => {
    const data = validPackData();
    data.variant = "half_commission";
    expect(() => validateRulePack(data)).toThrow(RulePackValidationError);
  });

  it("rejects an empty chip set", () => {
    const data = validPackData();
    data.chipset = { currency: "HKD", denominations: [] };
    expect(() => validateRulePack(data)).toThrow(RulePackValidationError);
  });

  it("collects issues on the thrown error", () => {
    const data = validPackData();
    data.limits = { min: 5000, max: 100 };
    try {
      validateRulePack(data);
      expect.unreachable("validation should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RulePackValidationError);
      expect((error as RulePackValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("loadRulePack", () => {
  it("loads and validates the bundled dev pack", async () => {
    const pack: RulePack = await loadRulePack(
      "dev/generic-macau-baccarat.v1.json",
    );
    expect(pack.id).toBe("generic-macau-baccarat");
    expect(pack.variant).toBe("standard");
    expect(pack.shoe.deckCount).toBe(8);
    expect(pack.sideBets).toHaveLength(2);
  });
});
