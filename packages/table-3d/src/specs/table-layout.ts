/**
 * Baccarat table geometry and seat layout.
 *
 * The table is kidney (waisted) shaped: the dealer stands at the flat edge and
 * guests sit around the curved edge. Seats are distributed on an ellipse arc
 * using the same angular span as the SVG design sheets, so the 3D table and the
 * printed layout stay in agreement.
 *
 * Reference: docs/superpowers/specs/2026-07-27-baccarat-table-real-spec.md
 */
import type { BetKind } from "@mct/shared";
import type { SideBetRule } from "@mct/rule-packs/schema";
import { millimetresToMetres } from "./dimensions.js";

export type TableVariant = "mass" | "vip";

/**
 * Orientation convention used everywhere in this package:
 *   -Z  →  dealer edge (flat side,荷官)
 *   +Z  →  guest arc   (curved side, 玩家)
 *    X  →  left-to-right across the table
 *    Y  →  up (scene vertical)
 *
 * The outline is built in the XY plane with:
 *   +Y  →  dealer edge  (maps to -Z after rotateX(-π/2))
 *   -Y  →  guest arc    (maps to +Z after rotateX(-π/2))
 * so the guest arc lands on the positive-Z side as required.
 */

/**
 * Mass-hall seven-seat table. A big-table layout is quoted at roughly
 * 154 x 62 inches; a seven-seat mass table is smaller, so the footprint below
 * sits at the common 2.4 m x 1.4 m for that class of table.
 */
export const TABLE_DIMENSIONS_MM = {
  /** Overall width across the flat dealer edge. */
  width: 2400,
  /** Depth from the dealer edge to the far point of the guest arc. */
  depth: 1400,
  /** Height of the playing surface from the floor. */
  surfaceHeight: 760,
  /** Thickness of the table top slab. */
  topThickness: 40,
  /** Width of the padded armrest rail running around the guest edge. */
  railWidth: 110,
  /** How far the rail stands above the felt. */
  railRise: 26,
} as const;

/**
 * Seats sit on an ellipse arc. The angular span matches `seat_positions_on_arc`
 * in the SVG generator so both renderings place seat 1 and seat 7 identically.
 */
export const SEAT_ARC = {
  /**
   * Angular span of the guest arc. Widened from the original ±28° inset so
   * seven blocks spread far enough apart to not crowd each other: at the old
   * span adjacent blocks were within a millimetre of touching.
   */
  startDegrees: -172,
  endDegrees: -8,
  /**
   * Ellipse radii as a fraction of the table half-width and depth.
   *
   * These are deliberately smaller than the table outline: the seat position is
   * the centre of the printed betting block, and the whole block (including the
   * pair circles and the seat number) must stay inside the felt, which is inset
   * by the rail on every side. The layout tests assert that margin against the
   * real block corners, so changing these ratios will fail loudly if a block
   * would hang onto the padded rail.
   */
  radiusXRatio: 0.62,
  radiusYRatio: 0.4,
} as const;

/**
 * Waist factor of the kidney outline at a given normalised half-width.
 * Shared by the geometry builder and the fit tests.
 */
export function computeOutlineWaist(normalisedX: number): number {
  return 1 - 0.18 * normalisedX ** 2;
}

/** Fraction of the depth that sits on the dealer side of the table centre. */
export const OUTLINE_DEALER_DEPTH_RATIO = 0.34;

/**
 * Felt bounds: the cloth is inset from the table outline by the rail on the
 * sides and by a slightly wider margin on the dealer edge.
 */
export const FELT_INSET = {
  halfWidth: millimetresToMetres(TABLE_DIMENSIONS_MM.width) / 2
    - millimetresToMetres(TABLE_DIMENSIONS_MM.railWidth),
  depth: millimetresToMetres(TABLE_DIMENSIONS_MM.depth)
    - millimetresToMetres(TABLE_DIMENSIONS_MM.railWidth) * 1.15,
} as const;

/**
 * World-Z of the felt's guest edge at a given X, in metres.
 * Positive Z is the guest side, so this is the furthest a printed marking can
 * reach at that lateral position.
 */
export function computeFeltGuestEdgeZ(x: number): number {
  const normalisedX = Math.max(-1, Math.min(1, x / FELT_INSET.halfWidth));
  const angle = Math.acos(normalisedX);
  const dealerEdgeZ = FELT_INSET.depth * OUTLINE_DEALER_DEPTH_RATIO;
  return (
    FELT_INSET.depth * Math.sin(angle) * computeOutlineWaist(normalisedX)
    - dealerEdgeZ
  );
}

/** World-Z of the felt's flat dealer edge (negative). */
export const FELT_DEALER_EDGE_Z =
  -FELT_INSET.depth * OUTLINE_DEALER_DEPTH_RATIO;

/** Seat numbering per hall type. Big tables skip 13 by local custom. */
export const MASS_SEAT_LABELS = [1, 2, 3, 4, 5, 6, 7] as const;
export const VIP_SEAT_LABELS = [1, 2, 3, 5, 6] as const;
export const BIG_TABLE_SEAT_LABELS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15,
] as const;

export function getSeatLabels(variant: TableVariant): readonly number[] {
  return variant === "vip" ? VIP_SEAT_LABELS : MASS_SEAT_LABELS;
}

/**
 * The betting spots available at one seat.
 *
 * Order matters for the printed layout: the spec requires PLAYER nearest the
 * guest, then BANKER, then TIE furthest towards the table centre.
 *
 * This is deliberately the engine's own `BetKind` rather than a parallel enum.
 * A click on a printed spot has to become a `place_bet` intent, and any private
 * spelling here would need a translation table that could silently drift from
 * the engine (the two once disagreed on `player_pair` vs `player-pair`). Reusing
 * the type means a mismatch is a compile error instead of a runtime surprise.
 */
export type BetSpotId = BetKind;

/**
 * One printed betting spot, described in the seat's own local frame.
 *
 * Local axes, before the seat's `facingRadians` rotation is applied:
 *   +localZ  →  towards the guest
 *   +localX  →  to the guest's right
 *
 * A rectangular spot is a box; a circular spot (the pair bets) carries a radius
 * instead. Sizes are driven by what a real bet needs rather than by what looks
 * balanced on a design sheet: a 39 mm chip has to sit inside a spot with room
 * for a stack, so no dimension here is smaller than about three chip diameters.
 */
export interface BetSpotSpec {
  readonly id: BetSpotId;
  readonly label: string;
  readonly sublabel: string;
  /** Spot centre along the seat's guest-facing axis, in metres. */
  readonly localZ: number;
  /** Spot centre across the seat, in metres. Non-zero for the pair circles. */
  readonly localX: number;
  readonly shape: "box" | "circle";
  /** Full width across the seat, for box spots. */
  readonly width: number;
  /** Full depth along the guest axis, for box spots. */
  readonly depth: number;
  /** Radius, for circle spots. */
  readonly radius: number;
}

/**
 * Printed block dimensions in metres.
 *
 * The earlier version used a 190 x 52 mm box, which is barely larger than a
 * single 39 mm chip and could not hold a stack: that is what made the betting
 * areas unusable. PLAYER and BANKER are now full betting boxes, TIE is the
 * narrow contrasting band real tables use, and the pair circles sit beside the
 * PLAYER box nearest the guest.
 */
export const SEAT_BLOCK = {
  /**
   * Width of the PLAYER and BANKER boxes.
   *
   * Seven blocks have to fit across 2.18 m of cloth, and each one is also fanned
   * outwards, which widens its lateral footprint. At 0.26 m the outer blocks
   * overlapped their neighbours (seat 7's pair circle landed inside seat 6's
   * BANKER box), so a click could not be attributed to one seat. 0.225 m still
   * holds a chip stack comfortably at 39 mm per chip.
   */
  boxWidth: 0.225,
  /** Depth of the PLAYER and BANKER boxes. */
  boxDepth: 0.115,
  /** TIE is a shallower band, as on a real layout. */
  tieDepth: 0.062,
  /** Gap between stacked spots. */
  boxGap: 0.012,
  /** Radius of the pair-bet circles. */
  pairRadius: 0.036,
} as const;

/**
 * The seat position marks the guest edge of the printed block, so the whole
 * block extends inwards from there. Keeping this at zero means "seat z" and
 * "where the guest's hands reach" are the same number.
 */
export const SEAT_BLOCK_GUEST_EDGE_LOCAL_Z = 0;

/**
 * Cap on how far an outer seat's block is turned. Real layouts fan the outer
 * blocks only slightly; a large angle swings the deep end of the block sideways
 * off the cloth, which the fit tests would reject.
 */
export const MAX_SEAT_FACING_RADIANS = (18 * Math.PI) / 180;

/**
 * Build the betting spots for one seat, in the seat's local frame.
 *
 * Laid out from the guest inwards:
 *   pair circles → PLAYER → BANKER → TIE
 * which is the order the real-table spec requires.
 */
export interface BetSpotRuleOptions {
  readonly tiePayout: string;
  readonly commissionRate: number | null;
  readonly sideBets: readonly SideBetRule[];
}

function formatPercentage(rate: number): string {
  return String(Number((rate * 100).toFixed(10)));
}

export function buildSeatBetSpots(
  options: BetSpotRuleOptions,
): readonly BetSpotSpec[] {
  const { tiePayout, commissionRate, sideBets } = options;
  const { boxWidth, boxDepth, tieDepth, boxGap, pairRadius } = SEAT_BLOCK;

  // Walk inwards from the guest edge. +localZ points at the guest, so moving
  // towards the table centre means decreasing localZ.
  const pairCentreZ = SEAT_BLOCK_GUEST_EDGE_LOCAL_Z - pairRadius;
  const playerCentreZ = pairCentreZ - pairRadius - boxGap - boxDepth / 2;
  const bankerCentreZ = playerCentreZ - boxDepth - boxGap;
  const tieCentreZ = bankerCentreZ - boxDepth / 2 - boxGap - tieDepth / 2;

  // Pair circles tuck into the corners beside the PLAYER box.
  const pairOffsetX = boxWidth / 2 - pairRadius;

  const sideBetSpots: BetSpotSpec[] = [];
  const playerPairRule = sideBets.find((sideBet) => sideBet.kind === "player_pair");
  if (playerPairRule !== undefined) {
    sideBetSpots.push({
      id: "player_pair",
      label: "閒對",
      sublabel: `${playerPairRule.payout} : 1`,
      localZ: pairCentreZ,
      localX: -pairOffsetX,
      shape: "circle",
      width: pairRadius * 2,
      depth: pairRadius * 2,
      radius: pairRadius,
    });
  }
  const bankerPairRule = sideBets.find((sideBet) => sideBet.kind === "banker_pair");
  if (bankerPairRule !== undefined) {
    sideBetSpots.push({
      id: "banker_pair",
      label: "莊對",
      sublabel: `${bankerPairRule.payout} : 1`,
      localZ: pairCentreZ,
      localX: pairOffsetX,
      shape: "circle",
      width: pairRadius * 2,
      depth: pairRadius * 2,
      radius: pairRadius,
    });
  }

  return [
    ...sideBetSpots,
    {
      id: "player",
      label: "閒 PLAYER",
      sublabel: "1 : 1",
      localZ: playerCentreZ,
      localX: 0,
      shape: "box",
      width: boxWidth,
      depth: boxDepth,
      radius: 0,
    },
    {
      id: "banker",
      label: "莊 BANKER",
      sublabel: commissionRate === null
        ? "1 : 1"
        : `1 : 1 扣 ${formatPercentage(commissionRate)}%`,
      localZ: bankerCentreZ,
      localX: 0,
      shape: "box",
      width: boxWidth,
      depth: boxDepth,
      radius: 0,
    },
    {
      id: "tie",
      label: "和 TIE",
      sublabel: tiePayout,
      localZ: tieCentreZ,
      localX: 0,
      shape: "box",
      width: boxWidth,
      depth: tieDepth,
      radius: 0,
    },
  ];
}

/** Reference spot list used by the geometry tests and the fit checks. */
export const REFERENCE_BET_SPOTS = buildSeatBetSpots({
  tiePayout: "8 : 1",
  commissionRate: 0.05,
  sideBets: [
    { kind: "player_pair", payout: 11 },
    { kind: "banker_pair", payout: 11 },
  ],
});

/** Total depth of the printed block, from the guest edge to the TIE band. */
export const SEAT_BLOCK_TOTAL_DEPTH =
  SEAT_BLOCK.pairRadius * 2
  + SEAT_BLOCK.boxGap
  + SEAT_BLOCK.boxDepth * 2
  + SEAT_BLOCK.boxGap
  + SEAT_BLOCK.boxGap
  + SEAT_BLOCK.tieDepth;

/** The seat number is printed just inside the guest edge of the block. */
export const SEAT_NUMBER_LOCAL_Z = SEAT_BLOCK_GUEST_EDGE_LOCAL_Z + 0.026;

/**
 * How far the printed block reaches from the seat centre towards the guest.
 * The seat number label is the outermost element.
 */
export const SEAT_BLOCK_GUEST_REACH = SEAT_NUMBER_LOCAL_Z + 0.016;

/**
 * How far the printed block reaches from the seat centre towards the dealer.
 * The TIE band is the innermost element.
 */
export const SEAT_BLOCK_DEALER_REACH = SEAT_BLOCK_TOTAL_DEPTH;

/**
 * Rotate a point from a seat's local frame into world coordinates.
 *
 * Every consumer has to agree on this transform: the felt texture draws the
 * spots with it, the demo bets are positioned with it, and the fit tests check
 * the resulting corners against the felt edge with it. Sharing one function is
 * what stops a printed box and the chip that belongs in it from drifting apart.
 */
export function seatLocalToWorld(
  seat: SeatPlacement,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const cosine = Math.cos(seat.facingRadians);
  const sine = Math.sin(seat.facingRadians);
  return {
    x: seat.x + localX * cosine - localZ * sine,
    z: seat.z + localX * sine + localZ * cosine,
  };
}

/** World position of a named betting spot at a seat. */
export function computeBetSpotPosition(
  seat: SeatPlacement,
  spotId: BetSpotId,
  spots: readonly BetSpotSpec[] = REFERENCE_BET_SPOTS,
): { x: number; z: number } {
  const spot = spots.find((candidate) => candidate.id === spotId);
  if (spot === undefined) {
    throw new Error(`Unknown bet spot: ${spotId}`);
  }
  return seatLocalToWorld(seat, spot.localX, spot.localZ);
}

/** World position of a seat's PLAYER box centre. */
export function computePlayerBoxPosition(
  seat: SeatPlacement,
): { x: number; z: number } {
  return computeBetSpotPosition(seat, "player");
}

/**
 * The four world-space corners of a betting spot's bounding box.
 * Circles use their bounding square, which is the conservative choice for a
 * "stays on the cloth" check.
 */
export function computeBetSpotCorners(
  seat: SeatPlacement,
  spot: BetSpotSpec,
): ReadonlyArray<{ x: number; z: number }> {
  const halfWidth = spot.width / 2;
  const halfDepth = spot.depth / 2;
  const localCorners = [
    { localX: spot.localX - halfWidth, localZ: spot.localZ - halfDepth },
    { localX: spot.localX + halfWidth, localZ: spot.localZ - halfDepth },
    { localX: spot.localX + halfWidth, localZ: spot.localZ + halfDepth },
    { localX: spot.localX - halfWidth, localZ: spot.localZ + halfDepth },
  ];
  return localCorners.map((corner) =>
    seatLocalToWorld(seat, corner.localX, corner.localZ),
  );
}

/**
 * Convert a world position into a seat's local frame.
 *
 * This is the inverse of `seatLocalToWorld`, used for hit testing: a click gives
 * a world point on the felt, and the local frame is where the spot rectangles
 * are defined. Inverting the same rotation both ways is what makes a click land
 * in the box the guest actually sees.
 */
export function worldToSeatLocal(
  seat: SeatPlacement,
  worldX: number,
  worldZ: number,
): { localX: number; localZ: number } {
  const offsetX = worldX - seat.x;
  const offsetZ = worldZ - seat.z;
  const cosine = Math.cos(seat.facingRadians);
  const sine = Math.sin(seat.facingRadians);
  // Rotating by -facingRadians undoes the seat's fan.
  return {
    localX: offsetX * cosine + offsetZ * sine,
    localZ: -offsetX * sine + offsetZ * cosine,
  };
}

/** A betting spot identified at a specific seat. */
export interface BetSpotHit {
  readonly seatLabel: number;
  readonly spotId: BetSpotId;
}

/**
 * Find which seat's betting spot contains a world position, or null.
 *
 * Boxes are tested as rectangles in the seat's local frame and circles by
 * radius, so a click in the gap between two spots correctly hits nothing rather
 * than snapping to the nearest one. Seats are checked in order and the first
 * containing spot wins; the layout tests assert the spots do not overlap, so
 * that order is not load-bearing.
 */
export function findBetSpotAtWorldPosition(
  worldX: number,
  worldZ: number,
  seats: readonly SeatPlacement[],
  spots: readonly BetSpotSpec[] = REFERENCE_BET_SPOTS,
): BetSpotHit | null {
  for (const seat of seats) {
    const { localX, localZ } = worldToSeatLocal(seat, worldX, worldZ);
    for (const spot of spots) {
      const offsetX = localX - spot.localX;
      const offsetZ = localZ - spot.localZ;

      if (spot.shape === "circle") {
        if (Math.hypot(offsetX, offsetZ) <= spot.radius) {
          return { seatLabel: seat.label, spotId: spot.id };
        }
        continue;
      }

      if (
        Math.abs(offsetX) <= spot.width / 2
        && Math.abs(offsetZ) <= spot.depth / 2
      ) {
        return { seatLabel: seat.label, spotId: spot.id };
      }
    }
  }
  return null;
}

/** Converted-to-metres table figures used by the geometry builders. */
export const TABLE_SIZE = {
  width: millimetresToMetres(TABLE_DIMENSIONS_MM.width),
  depth: millimetresToMetres(TABLE_DIMENSIONS_MM.depth),
  surfaceHeight: millimetresToMetres(TABLE_DIMENSIONS_MM.surfaceHeight),
  topThickness: millimetresToMetres(TABLE_DIMENSIONS_MM.topThickness),
  railWidth: millimetresToMetres(TABLE_DIMENSIONS_MM.railWidth),
  railRise: millimetresToMetres(TABLE_DIMENSIONS_MM.railRise),
} as const;

export interface SeatPlacement {
  readonly label: number;
  /** Lateral offset from the table centre, in metres. */
  readonly x: number;
  /** Distance towards the guest side from the table centre, in metres. */
  readonly z: number;
  /** Rotation about the vertical axis so printed art faces the guest, radians. */
  readonly facingRadians: number;
}

/**
 * Distribute seats along the guest arc.
 *
 * The table's local frame puts the dealer at negative Z and guests at positive
 * Z, with X running along the flat edge. The SVG generator works in screen
 * space where Y grows downwards, so the sine term is negated here to keep both
 * layouts consistent.
 */
export function computeSeatPlacements(
  variant: TableVariant,
): readonly SeatPlacement[] {
  const labels = getSeatLabels(variant);
  const radiusX = (TABLE_SIZE.width / 2) * SEAT_ARC.radiusXRatio;
  const radiusZ = TABLE_SIZE.depth * SEAT_ARC.radiusYRatio;

  return labels.map((label, seatIndex) => {
    const progress =
      labels.length === 1 ? 0.5 : seatIndex / (labels.length - 1);
    const angleDegrees =
      SEAT_ARC.startDegrees +
      (SEAT_ARC.endDegrees - SEAT_ARC.startDegrees) * progress;
    const angleRadians = (angleDegrees * Math.PI) / 180;

    const x = radiusX * Math.cos(angleRadians);
    const z = -radiusZ * Math.sin(angleRadians);

    // Fan each block so it squares up with the guest sitting there: the block's
    // deep end (BANKER, TIE) turns towards the table centre while its guest edge
    // stays in front of the seat.
    //
    // The sign matters. `seatLocalToWorld` maps the local guest axis (+localZ)
    // to the world direction (-sin θ, cos θ), so a seat right of centre needs a
    // negative θ for its block to lean inwards. Using +atan2 here fanned every
    // block the wrong way, which is what made the betting spots feel wrong.
    //
    // The rotation is capped: a real layout only turns the outer blocks a
    // little, and a large angle would swing the deep block off the cloth.
    const unclampedFacing = -Math.atan2(x, radiusZ * 2.4);
    const facingRadians = Math.max(
      -MAX_SEAT_FACING_RADIANS,
      Math.min(MAX_SEAT_FACING_RADIANS, unclampedFacing),
    );

    return { label, x, z, facingRadians };
  });
}

/**
 * Where each fixed prop sits in the dealer's working area, as offsets from the
 * table centre in metres. Positions follow the real working-area table in the
 * spec: shoe on one side, tray directly in front of the dealer, drop box on the
 * other side, discard rack and limit sign at the corners.
 */
export const DEALER_STATION_LAYOUT = {
  chipTray: { x: 0, z: -millimetresToMetres(275) },
  dealingShoe: { x: millimetresToMetres(520), z: -millimetresToMetres(295) },
  discardHolder: { x: -millimetresToMetres(560), z: -millimetresToMetres(300) },
  dropBox: { x: -millimetresToMetres(255), z: -millimetresToMetres(375) },
  limitSign: { x: millimetresToMetres(870), z: -millimetresToMetres(340) },
  roadmapMonitor: { x: 0, z: -millimetresToMetres(400) },
  /** Commission markers sit in a row in front of the tray, guest side. */
  commissionRow: { x: 0, z: -millimetresToMetres(170) },
} as const;
