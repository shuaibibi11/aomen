/**
 * Rule-pack schema.
 *
 * A rule pack is the versioned, data-only definition of how one table plays:
 * the commission variant, betting limits, which side bets are open, the shoe
 * and dealing rules, the chip set, and which script/scene assets to use. The
 * engine reads a validated pack; it never hard-codes a single casino's rules.
 *
 * The Zod schema is the single gate: anything that parses is a shape the engine
 * can trust, so downstream code needs no defensive checks.
 */
import { z } from "zod";

/**
 * Commission variant.
 *   standard       → banker wins pay 1:1 minus 5% commission
 *   no_commission  → banker wins pay 1:1, except a banker win on 6 pays 1:2
 */
export const commissionVariantSchema = z.enum(["standard", "no_commission"]);
export type CommissionVariant = z.infer<typeof commissionVariantSchema>;

/** Min/max bet limits, in training chips. */
export const betLimitsSchema = z
  .object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  })
  .refine((limits) => limits.max >= limits.min, {
    message: "max must be greater than or equal to min",
  });
export type BetLimits = z.infer<typeof betLimitsSchema>;

/** Commission settings. Only meaningful when variant is "standard". */
export const commissionSchema = z.object({
  /** Fraction taken from a banker win, e.g. 0.05 for 5%. */
  rate: z.number().min(0).max(1),
});
export type CommissionRule = z.infer<typeof commissionSchema>;

/** One side bet the pack opens, with its payout odds (winnings-to-stake). */
export const sideBetSchema = z.object({
  kind: z.enum(["player_pair", "banker_pair"]),
  /** Payout as a multiple of the stake, e.g. 11 for 11:1. */
  payout: z.number().positive(),
});
export type SideBetRule = z.infer<typeof sideBetSchema>;

/** Main-bet payouts, as winnings-to-stake multiples. */
export const mainPayoutsSchema = z.object({
  player: z.number().positive(),
  banker: z.number().positive(),
  tie: z.number().positive(),
  /**
   * Payout for a banker win on a total of 6 under no-commission rules.
   * Ignored by the standard variant.
   */
  bankerSixPayout: z.number().positive().optional(),
});
export type MainPayouts = z.infer<typeof mainPayoutsSchema>;

/** Shoe composition and cut-card settings. */
export const shoeSchema = z.object({
  deckCount: z.number().int().positive(),
  /**
   * Cut-card penetration as a fraction of the shoe, e.g. 0.9. Retained for
   * later phases; this phase does not implement penetration reshuffling.
   */
  penetration: z.number().min(0).max(1).optional(),
});
export type ShoeRule = z.infer<typeof shoeSchema>;

/** Dealing options. */
export const dealingSchema = z.object({
  /** Whether the biggest bettor may squeeze (peek) the cards. */
  peekAllowed: z.boolean(),
});
export type DealingRule = z.infer<typeof dealingSchema>;

/** One chip denomination in the pack's chip set. */
export const chipDenominationSchema = z.number().int().positive();

/** The chip set offered at the table, in training-chip values. */
export const chipsetSchema = z.object({
  currency: z.string().min(1),
  denominations: z.array(chipDenominationSchema).min(1),
});
export type Chipset = z.infer<typeof chipsetSchema>;

/**
 * The full rule pack. `id` and `version` identify the pack in the event log so
 * a replay always knows exactly which rules produced it.
 */
export const rulePackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  variant: commissionVariantSchema,
  limits: betLimitsSchema,
  commission: commissionSchema,
  mainPayouts: mainPayoutsSchema,
  sideBets: z.array(sideBetSchema),
  shoe: shoeSchema,
  dealing: dealingSchema,
  chipset: chipsetSchema,
  /** Which teaching-script pack to load, resolved by the pedagogy layer. */
  scriptPackId: z.string().min(1).optional(),
  /** Which 3D scene/theme to load, resolved by the presentation layer. */
  sceneProfile: z.string().min(1).optional(),
});
export type RulePack = z.infer<typeof rulePackSchema>;
