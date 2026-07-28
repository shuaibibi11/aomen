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
import { millimetresToMetres } from "./dimensions.js";

export type TableVariant = "mass" | "vip";

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
  startDegrees: -152,
  endDegrees: -28,
  /** Ellipse radii as a fraction of the table half-width and depth. */
  radiusXRatio: 0.82,
  radiusYRatio: 0.62,
} as const;

/** Seat numbering per hall type. Big tables skip 13 by local custom. */
export const MASS_SEAT_LABELS = [1, 2, 3, 4, 5, 6, 7] as const;
export const VIP_SEAT_LABELS = [1, 2, 3, 5, 6] as const;
export const BIG_TABLE_SEAT_LABELS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15,
] as const;

export function getSeatLabels(variant: TableVariant): readonly number[] {
  return variant === "vip" ? VIP_SEAT_LABELS : MASS_SEAT_LABELS;
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

    // Turn each seat block towards the dealer, matching the SVG facing rule.
    const facingRadians = Math.atan2(x, radiusZ * 1.35) * 0.85;

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
  chipTray: { x: 0, z: -millimetresToMetres(300) },
  dealingShoe: { x: millimetresToMetres(520), z: -millimetresToMetres(300) },
  discardHolder: { x: -millimetresToMetres(560), z: -millimetresToMetres(330) },
  dropBox: { x: -millimetresToMetres(260), z: -millimetresToMetres(430) },
  limitSign: { x: millimetresToMetres(880), z: -millimetresToMetres(400) },
  roadmapMonitor: { x: 0, z: -millimetresToMetres(560) },
  /** Commission markers sit in a row in front of the tray, guest side. */
  commissionRow: { x: 0, z: -millimetresToMetres(170) },
} as const;
