/**
 * Chip denomination colour convention.
 *
 * Macau tables rely on colour to read a stack at a glance, so the body colour
 * of a denomination is close to universal across properties. Each casino only
 * restyles the rim inserts, the ring banding and the mould profile, which come
 * from that casino's theme data.
 */

export interface DenominationStyle {
  /** Main clay body colour. */
  readonly body: string;
  /** Colour of the alternating rim inserts. */
  readonly insert: string;
  /** Ink colour used for the value printed on the inlay. */
  readonly ink: string;
  /** Short label printed on the inlay face. */
  readonly label: string;
}

export const DENOMINATION_STYLES: Record<number, DenominationStyle> = {
  100: { body: "#1F1F1F", insert: "#F2F2F2", ink: "#F5F0E1", label: "100" },
  500: { body: "#5B2A86", insert: "#E9DDF5", ink: "#F7F1FF", label: "500" },
  1000: { body: "#B58A16", insert: "#3A2A08", ink: "#20180A", label: "1K" },
  5000: { body: "#A81E2E", insert: "#F6DADA", ink: "#FFF2F2", label: "5K" },
  10000: { body: "#1F5FA8", insert: "#DCEBFA", ink: "#EEF6FF", label: "10K" },
};

export const DEFAULT_DENOMINATION_STYLE: DenominationStyle = {
  body: "#2C2C2C",
  insert: "#EEEEEE",
  ink: "#F5F5F5",
  label: "?",
};

export function getDenominationStyle(denomination: number): DenominationStyle {
  return DENOMINATION_STYLES[denomination] ?? DEFAULT_DENOMINATION_STYLE;
}

/**
 * Rim profile differences between casinos. The values drive how the rim is
 * chamfered and how the insert bands are cut, so no two chip sets read alike.
 */
export interface MouldProfile {
  /** Chamfer scale applied at the top and bottom rim edges. */
  readonly chamferScale: number;
  /** Angular width of each insert as a fraction of its slot. */
  readonly insertWidthRatio: number;
  /** Number of concentric ring grooves pressed into the face. */
  readonly ringGrooveCount: number;
  /** Whether the rim carries fine vertical teeth. */
  readonly hasRimTeeth: boolean;
  /** Extra rim band drawn in the casino's metallic colour. */
  readonly metallicRimBand: boolean;
}

export const MOULD_PROFILES: Record<string, MouldProfile> = {
  "fine-teeth": {
    chamferScale: 0.8,
    insertWidthRatio: 0.42,
    ringGrooveCount: 3,
    hasRimTeeth: true,
    metallicRimBand: false,
  },
  "double-ring": {
    chamferScale: 0.6,
    insertWidthRatio: 0.5,
    ringGrooveCount: 2,
    hasRimTeeth: false,
    metallicRimBand: true,
  },
  "wide-gold": {
    chamferScale: 1.4,
    insertWidthRatio: 0.62,
    ringGrooveCount: 1,
    hasRimTeeth: false,
    metallicRimBand: true,
  },
  bevel: {
    chamferScale: 1.8,
    insertWidthRatio: 0.36,
    ringGrooveCount: 2,
    hasRimTeeth: false,
    metallicRimBand: false,
  },
  "square-edge": {
    chamferScale: 0.15,
    insertWidthRatio: 0.55,
    ringGrooveCount: 1,
    hasRimTeeth: false,
    metallicRimBand: false,
  },
  "copper-teeth": {
    chamferScale: 0.9,
    insertWidthRatio: 0.34,
    ringGrooveCount: 4,
    hasRimTeeth: true,
    metallicRimBand: true,
  },
};

export const DEFAULT_MOULD_PROFILE: MouldProfile = {
  chamferScale: 1,
  insertWidthRatio: 0.5,
  ringGrooveCount: 2,
  hasRimTeeth: false,
  metallicRimBand: false,
};

export function getMouldProfile(chipMould: string): MouldProfile {
  return MOULD_PROFILES[chipMould] ?? DEFAULT_MOULD_PROFILE;
}
