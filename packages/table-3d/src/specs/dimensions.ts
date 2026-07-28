/**
 * Real-world dimensions for casino table props.
 *
 * Scene units are metres so this package can be dropped into a full table
 * scene later without rescaling. Every physical figure is declared in
 * millimetres and converted once, here, rather than being hard-coded into
 * geometry calls.
 */

export const MILLIMETRES_PER_METRE = 1000;

export function millimetresToMetres(millimetres: number): number {
  return millimetres / MILLIMETRES_PER_METRE;
}

/**
 * Casino chips are a standardised 39 mm disc. Weight varies by composition
 * (clay composite vs ceramic) but the silhouette does not.
 */
export const CHIP_DIMENSIONS_MM = {
  diameter: 39,
  thickness: 3.3,
  /** Depth of the recessed inlay on the top and bottom faces. */
  inlayDiameter: 24,
  inlayRecessDepth: 0.15,
  /** Radial depth of the coloured edge inserts cut into the rim. */
  edgeInsertDepth: 1.6,
  /** How far the chamfer eats into the rim at each face. */
  rimChamfer: 0.45,
} as const;

/**
 * Baccarat is dealt with bridge-size cards (narrower than poker size) because
 * the shoe holds eight decks and the narrower stock reduces shoe length.
 */
export const CARD_DIMENSIONS_MM = {
  width: 57,
  height: 89,
  thickness: 0.31,
  cornerRadius: 3,
  /** White border printed around the back design. */
  backBorderInset: 3.2,
} as const;

/**
 * Dealers count chips in stacks of twenty; a full stack is the standard unit
 * for paying and for reading a guest's position at a glance.
 */
export const CHIP_STACK_COUNT = 20;

/** Baccarat shoes hold eight decks. */
export const DECKS_PER_SHOE = 8;
export const CARDS_PER_DECK = 52;
export const CARDS_PER_SHOE = DECKS_PER_SHOE * CARDS_PER_DECK;

/** Converted-to-metres values used directly by the geometry builders. */
export const CHIP_SIZE = {
  radius: millimetresToMetres(CHIP_DIMENSIONS_MM.diameter / 2),
  thickness: millimetresToMetres(CHIP_DIMENSIONS_MM.thickness),
  inlayRadius: millimetresToMetres(CHIP_DIMENSIONS_MM.inlayDiameter / 2),
  inlayRecessDepth: millimetresToMetres(CHIP_DIMENSIONS_MM.inlayRecessDepth),
  edgeInsertDepth: millimetresToMetres(CHIP_DIMENSIONS_MM.edgeInsertDepth),
  rimChamfer: millimetresToMetres(CHIP_DIMENSIONS_MM.rimChamfer),
} as const;

export const CARD_SIZE = {
  width: millimetresToMetres(CARD_DIMENSIONS_MM.width),
  height: millimetresToMetres(CARD_DIMENSIONS_MM.height),
  thickness: millimetresToMetres(CARD_DIMENSIONS_MM.thickness),
  cornerRadius: millimetresToMetres(CARD_DIMENSIONS_MM.cornerRadius),
} as const;

/**
 * Real chips sit with a hair of air between them, so a stack of twenty is
 * slightly taller than twenty times the disc thickness.
 */
export const CHIP_STACK_GAP = millimetresToMetres(0.06);

/** Cards in a dealt hand are fanned rather than perfectly aligned. */
export const CARD_STACK_GAP = millimetresToMetres(0.04);
