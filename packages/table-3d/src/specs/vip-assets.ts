/**
 * High-denomination plaque values and membership tier structures.
 *
 * Tier names follow each operator's publicly published loyalty programme so
 * the training material matches what a trainee will hear on the floor. Card
 * artwork itself is original: only the tier vocabulary is shared.
 */
import type { CasinoId } from "./casino-theme.js";

/** Plaque values used in Macau VIP rooms, in HKD. */
export const PLAQUE_DENOMINATIONS = [100_000, 500_000, 1_000_000, 5_000_000] as const;

export type PlaqueDenomination = (typeof PLAQUE_DENOMINATIONS)[number];

export interface PlaqueStyle {
  /** Body colour of the acrylic slab. */
  readonly body: string;
  /** Colour of the metal-look name plate. */
  readonly plate: string;
  /** Ink used for the printed value. */
  readonly ink: string;
  /** Human-readable value label. */
  readonly label: string;
}

/**
 * Plaque colours escalate with value the way chip colours do, so a supervisor
 * can read a tray from across the pit.
 */
export const PLAQUE_STYLES: Record<number, PlaqueStyle> = {
  100_000: { body: "#F0EAD6", plate: "#B99A4B", ink: "#2A2213", label: "100,000" },
  500_000: { body: "#2E5F94", plate: "#D8DEE6", ink: "#F2F7FC", label: "500,000" },
  1_000_000: { body: "#7A1F2B", plate: "#D9B45A", ink: "#FBEFD8", label: "1,000,000" },
  5_000_000: { body: "#1C1C22", plate: "#CBA84E", ink: "#F6E9C4", label: "5,000,000" },
};

export const DEFAULT_PLAQUE_STYLE: PlaqueStyle = {
  body: "#E8E2CE",
  plate: "#B8A165",
  ink: "#26201A",
  label: "—",
};

export function getPlaqueStyle(denomination: number): PlaqueStyle {
  return PLAQUE_STYLES[denomination] ?? DEFAULT_PLAQUE_STYLE;
}

export interface MembershipTier {
  /** Tier name as published by the operator. */
  readonly name: string;
  /** Dominant card colour. */
  readonly cardColour: string;
  /** Accent used for the tier band and lettering. */
  readonly accentColour: string;
  /** Whether the card reads as a metal-finish card. */
  readonly metallic: boolean;
}

export interface MembershipProgramme {
  /** Programme name as published by the operator. */
  readonly programmeName: string;
  /** Lowest tier first. */
  readonly tiers: readonly MembershipTier[];
}

/**
 * Tier ladders taken from each operator's public membership pages. Where a
 * programme publishes more tiers than are useful for training, the ladder is
 * trimmed to the tiers a dealer actually needs to recognise at the table.
 */
export const MEMBERSHIP_PROGRAMMES: Record<CasinoId, MembershipProgramme> = {
  "sands-venetian": {
    programmeName: "Sands Rewards",
    tiers: [
      { name: "Gold", cardColour: "#2B2B30", accentColour: "#C9A44C", metallic: false },
      { name: "Ruby", cardColour: "#6E1B26", accentColour: "#E3B7BE", metallic: false },
      { name: "Diamond", cardColour: "#1A2E4A", accentColour: "#D7E3F2", metallic: true },
    ],
  },
  galaxy: {
    programmeName: "GEG Privilege Club",
    tiers: [
      { name: "Gold", cardColour: "#3A2E16", accentColour: "#D4AF52", metallic: false },
      { name: "Platinum", cardColour: "#3C4550", accentColour: "#DDE3EA", metallic: true },
      { name: "Black", cardColour: "#121216", accentColour: "#9AA3AD", metallic: true },
      { name: "Diamond", cardColour: "#1B3A57", accentColour: "#BFE0F5", metallic: true },
    ],
  },
  wynn: {
    programmeName: "Wynn Rewards",
    tiers: [
      { name: "Red", cardColour: "#7C1620", accentColour: "#E8C877", metallic: false },
      { name: "Gold", cardColour: "#4A3717", accentColour: "#D9B45A", metallic: true },
      { name: "Platinum", cardColour: "#33383C", accentColour: "#E6EAED", metallic: true },
    ],
  },
  "melco-cod": {
    programmeName: "Melco Club",
    tiers: [
      { name: "Classic", cardColour: "#26202E", accentColour: "#B9A6D4", metallic: false },
      { name: "Silver", cardColour: "#3E4048", accentColour: "#DCDFE4", metallic: true },
      { name: "Gold", cardColour: "#3E3216", accentColour: "#D8B75B", metallic: true },
      { name: "Platinum", cardColour: "#2A2F3A", accentColour: "#D2DAE6", metallic: true },
      { name: "Diamond", cardColour: "#1E1436", accentColour: "#C9A7F0", metallic: true },
    ],
  },
  mgm: {
    programmeName: "MGM Rewards",
    tiers: [
      { name: "Pearl", cardColour: "#E7E2D6", accentColour: "#8A7A4E", metallic: false },
      { name: "Gold", cardColour: "#3B3216", accentColour: "#D5B558", metallic: true },
      { name: "Platinum", cardColour: "#31363B", accentColour: "#E2E7EB", metallic: true },
      { name: "Noir", cardColour: "#0E0E11", accentColour: "#C6A959", metallic: true },
    ],
  },
  "sjm-lisboa": {
    programmeName: "SJM Rewards",
    tiers: [
      { name: "Classic", cardColour: "#5A1A1A", accentColour: "#E0C070", metallic: false },
      { name: "Gold", cardColour: "#42320F", accentColour: "#DEB94F", metallic: true },
      { name: "Platinum", cardColour: "#2F343A", accentColour: "#DFE5EA", metallic: true },
    ],
  },
};

export function getMembershipProgramme(casinoId: CasinoId): MembershipProgramme {
  return MEMBERSHIP_PROGRAMMES[casinoId];
}
