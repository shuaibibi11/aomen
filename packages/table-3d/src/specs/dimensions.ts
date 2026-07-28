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
 * High-denomination plaques are rectangular rather than round. Common
 * manufactured sizes sit around 107x75 mm and 118x82 mm; the larger size is
 * used here because Macau VIP rooms favour the larger format for big values.
 * Plaques are thicker and heavier than chips (up to ~46 g).
 */
export const PLAQUE_DIMENSIONS_MM = {
  width: 118,
  height: 82,
  thickness: 3.6,
  cornerRadius: 6,
  /** Inset of the printed/engraved inner panel. */
  panelInset: 7,
  /** Metal-look name plate applied to the centre of the panel. */
  namePlateWidth: 62,
  namePlateHeight: 22,
} as const;

/**
 * Membership cards follow the ISO/IEC 7810 ID-1 format used by every bank and
 * loyalty card, so the model reuses the real standard rather than guessing.
 */
export const MEMBER_CARD_DIMENSIONS_MM = {
  width: 85.6,
  height: 53.98,
  thickness: 0.76,
  cornerRadius: 3.18,
} as const;

/**
 * Eight-deck dealing shoe. Manufacturer sizes cluster around 420x105x145 mm;
 * the front is a sloped mouth the dealer slides cards out of, and the rear
 * carries a weighted roller that presses the stack forward.
 */
export const DEALING_SHOE_DIMENSIONS_MM = {
  length: 420,
  width: 105,
  /** Height at the tall rear wall. */
  rearHeight: 145,
  /** Height at the low front mouth where cards leave the shoe. */
  frontHeight: 62,
  wallThickness: 6,
  baseThickness: 8,
  /** Width of the slot the dealer's thumb passes through. */
  mouthOpening: 74,
} as const;

/**
 * The cut card is inserted near the back of the stack. When it reaches the
 * mouth the shoe is finished, which is how penetration is enforced.
 */
export const CUT_CARD_DIMENSIONS_MM = {
  width: 60,
  height: 92,
  thickness: 1.2,
} as const;

/**
 * Eight-deck discard holder, sized from the manufactured 105x74x174 mm part.
 * Used cards are dropped in face down until the shoe ends.
 */
export const DISCARD_HOLDER_DIMENSIONS_MM = {
  width: 105,
  depth: 74,
  height: 174,
  wallThickness: 5,
  baseThickness: 10,
} as const;

/** Table limit sign standing at the dealer's right. */
export const LIMIT_SIGN_DIMENSIONS_MM = {
  width: 150,
  height: 100,
  thickness: 9,
  /** Height of the wedge foot that props the sign up. */
  baseHeight: 16,
  /** Backwards lean so the face reads from the player side. */
  leanDegrees: 14,
} as const;

/** Commission markers sit on the layout to flag a seat that owes commission. */
export const COMMISSION_MARKER_DIMENSIONS_MM = {
  diameter: 25,
  thickness: 4,
} as const;

/**
 * Roadmap monitor mounted in the table surface. A 16:9 panel is standard, and
 * the bezel is deep enough to protect the glass from chips.
 */
export const ROADMAP_MONITOR_DIMENSIONS_MM = {
  screenWidth: 420,
  screenHeight: 236,
  bezelWidth: 14,
  bodyDepth: 32,
  /** Backwards lean so the dealer and players both read it. */
  leanDegrees: 22,
} as const;

/**
 * Dealer chip trays are built around rows of twenty chips. The common casino
 * tray is five rows wide with a 68 mm row pitch.
 */
export const CHIP_TRAY_SPEC = {
  rowCount: 5,
  chipsPerRow: 20,
  /** Centre-to-centre distance between rows. */
  rowPitchMm: 68,
  /** Depth of the chip channel below the tray lip. */
  channelDepthMm: 26,
  wallThicknessMm: 6,
  /** Extra length beyond the chip run, for the end walls. */
  endMarginMm: 12,
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

export const PLAQUE_SIZE = {
  width: millimetresToMetres(PLAQUE_DIMENSIONS_MM.width),
  height: millimetresToMetres(PLAQUE_DIMENSIONS_MM.height),
  thickness: millimetresToMetres(PLAQUE_DIMENSIONS_MM.thickness),
  cornerRadius: millimetresToMetres(PLAQUE_DIMENSIONS_MM.cornerRadius),
} as const;

export const MEMBER_CARD_SIZE = {
  width: millimetresToMetres(MEMBER_CARD_DIMENSIONS_MM.width),
  height: millimetresToMetres(MEMBER_CARD_DIMENSIONS_MM.height),
  thickness: millimetresToMetres(MEMBER_CARD_DIMENSIONS_MM.thickness),
  cornerRadius: millimetresToMetres(MEMBER_CARD_DIMENSIONS_MM.cornerRadius),
} as const;

export const DEALING_SHOE_SIZE = {
  length: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.length),
  width: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.width),
  rearHeight: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.rearHeight),
  frontHeight: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.frontHeight),
  wallThickness: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.wallThickness),
  baseThickness: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.baseThickness),
  mouthOpening: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.mouthOpening),
} as const;

export const CUT_CARD_SIZE = {
  width: millimetresToMetres(CUT_CARD_DIMENSIONS_MM.width),
  height: millimetresToMetres(CUT_CARD_DIMENSIONS_MM.height),
  thickness: millimetresToMetres(CUT_CARD_DIMENSIONS_MM.thickness),
} as const;

export const DISCARD_HOLDER_SIZE = {
  width: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.width),
  depth: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.depth),
  height: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.height),
  wallThickness: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.wallThickness),
  baseThickness: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.baseThickness),
} as const;

export const LIMIT_SIGN_SIZE = {
  width: millimetresToMetres(LIMIT_SIGN_DIMENSIONS_MM.width),
  height: millimetresToMetres(LIMIT_SIGN_DIMENSIONS_MM.height),
  thickness: millimetresToMetres(LIMIT_SIGN_DIMENSIONS_MM.thickness),
  baseHeight: millimetresToMetres(LIMIT_SIGN_DIMENSIONS_MM.baseHeight),
} as const;

export const COMMISSION_MARKER_SIZE = {
  radius: millimetresToMetres(COMMISSION_MARKER_DIMENSIONS_MM.diameter / 2),
  thickness: millimetresToMetres(COMMISSION_MARKER_DIMENSIONS_MM.thickness),
} as const;

export const ROADMAP_MONITOR_SIZE = {
  screenWidth: millimetresToMetres(ROADMAP_MONITOR_DIMENSIONS_MM.screenWidth),
  screenHeight: millimetresToMetres(ROADMAP_MONITOR_DIMENSIONS_MM.screenHeight),
  bezelWidth: millimetresToMetres(ROADMAP_MONITOR_DIMENSIONS_MM.bezelWidth),
  bodyDepth: millimetresToMetres(ROADMAP_MONITOR_DIMENSIONS_MM.bodyDepth),
} as const;

export const CHIP_TRAY_SIZE = {
  rowPitch: millimetresToMetres(CHIP_TRAY_SPEC.rowPitchMm),
  channelDepth: millimetresToMetres(CHIP_TRAY_SPEC.channelDepthMm),
  wallThickness: millimetresToMetres(CHIP_TRAY_SPEC.wallThicknessMm),
  endMargin: millimetresToMetres(CHIP_TRAY_SPEC.endMarginMm),
} as const;

/**
 * Real chips sit with a hair of air between them, so a stack of twenty is
 * slightly taller than twenty times the disc thickness.
 */
export const CHIP_STACK_GAP = millimetresToMetres(0.06);

/** Cards in a dealt hand are fanned rather than perfectly aligned. */
export const CARD_STACK_GAP = millimetresToMetres(0.04);
