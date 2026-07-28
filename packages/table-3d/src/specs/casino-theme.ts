/**
 * Casino theme types and loading.
 *
 * The JSON files under assets/casinos are the single source of design tokens
 * shared by the SVG previews and these 3D models. They are imported
 * statically so the same data is available in dev and in a production build
 * without any server-side path configuration.
 */
import galaxyTheme from "../../../../assets/casinos/galaxy/theme.json";
import melcoTheme from "../../../../assets/casinos/melco-cod/theme.json";
import mgmTheme from "../../../../assets/casinos/mgm/theme.json";
import sandsTheme from "../../../../assets/casinos/sands-venetian/theme.json";
import sjmTheme from "../../../../assets/casinos/sjm-lisboa/theme.json";
import wynnTheme from "../../../../assets/casinos/wynn/theme.json";

export type ChipMould =
  | "fine-teeth"
  | "double-ring"
  | "wide-gold"
  | "bevel"
  | "square-edge"
  | "copper-teeth";

export type CardEngraving =
  | "arch"
  | "orbit"
  | "petal"
  | "lattice"
  | "feline"
  | "lotus";

export interface CasinoPalette {
  readonly feltMain: string;
  readonly feltMid: string;
  readonly feltShadow: string;
  readonly rail: string;
  readonly railDark: string;
  readonly accent: string;
  readonly gold: string;
  readonly lineColor: string;
  readonly tieBand: string;
  readonly cardBack: string;
}

export interface CasinoMaterials {
  readonly feltWeave: string;
  readonly railStyle: string;
  readonly borderOrnament: string;
  readonly medallion: string;
  readonly cardEngrave: string;
  readonly chipMould: string;
  readonly chipInserts: number;
  readonly boardStyle: string;
  readonly monitorStyle: string;
  readonly plaqueStyle: string;
  readonly labelFont: string;
}

export interface CasinoTheme {
  readonly casinoId: string;
  readonly displayName: string;
  readonly displayNameEn: string;
  readonly disclaimer: string;
  readonly palette: CasinoPalette;
  readonly materials: CasinoMaterials;
  readonly chipDenominations: readonly number[];
  readonly tableRules: {
    readonly currency: string;
    readonly commission: boolean;
    readonly tiePayout: string;
  };
}

/** Display order matches the SVG preview index so the two stay comparable. */
export const CASINO_IDS = [
  "sands-venetian",
  "galaxy",
  "wynn",
  "melco-cod",
  "mgm",
  "sjm-lisboa",
] as const;

export type CasinoId = (typeof CASINO_IDS)[number];

const THEMES_BY_ID: Record<CasinoId, CasinoTheme> = {
  "sands-venetian": sandsTheme as CasinoTheme,
  galaxy: galaxyTheme as CasinoTheme,
  wynn: wynnTheme as CasinoTheme,
  "melco-cod": melcoTheme as CasinoTheme,
  mgm: mgmTheme as CasinoTheme,
  "sjm-lisboa": sjmTheme as CasinoTheme,
};

/**
 * Monogram struck into the chip inlay and the card back. This is a 3D-only
 * presentation detail, so it lives here rather than in the shared theme data.
 */
export const CASINO_MONOGRAMS: Record<CasinoId, string> = {
  "sands-venetian": "V",
  galaxy: "G",
  wynn: "W",
  "melco-cod": "M",
  mgm: "M",
  "sjm-lisboa": "S",
};

export function getCasinoTheme(casinoId: CasinoId): CasinoTheme {
  return THEMES_BY_ID[casinoId];
}

export function getAllCasinoThemes(): CasinoTheme[] {
  return CASINO_IDS.map((casinoId) => THEMES_BY_ID[casinoId]);
}

export function getCasinoMonogram(casinoId: CasinoId): string {
  return CASINO_MONOGRAMS[casinoId];
}
