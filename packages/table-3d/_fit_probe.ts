/**
 * Throwaway fit probe. Prints the worst-case margins for the current seat arc
 * and block dimensions so the constants can be tuned against real numbers
 * instead of guesses. Deleted once the layout tests cover this.
 */
import {
  computeBetSpotCorners,
  computeFeltGuestEdgeZ,
  computeSeatPlacements,
  DEALER_STATION_LAYOUT,
  FELT_DEALER_EDGE_Z,
  FELT_INSET,
  REFERENCE_BET_SPOTS,
  SEAT_BLOCK,
} from "./src/specs/table-layout.js";
import { CHIP_TRAY_FOOTPRINT } from "./src/models/chip-tray.js";
import {
  DEALING_SHOE_DIMENSIONS_MM,
  DISCARD_HOLDER_DIMENSIONS_MM,
  LIMIT_SIGN_DIMENSIONS_MM,
  millimetresToMetres,
} from "./src/specs/dimensions.js";

/** Axis-aligned footprints of the dealer props, in metres. */
const PROP_FOOTPRINTS = [
  {
    name: "chipTray",
    centre: DEALER_STATION_LAYOUT.chipTray,
    halfWidth: CHIP_TRAY_FOOTPRINT.length / 2,
    halfDepth: CHIP_TRAY_FOOTPRINT.width / 2,
  },
  {
    name: "dealingShoe",
    centre: DEALER_STATION_LAYOUT.dealingShoe,
    halfWidth: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.width) / 2,
    halfDepth: millimetresToMetres(DEALING_SHOE_DIMENSIONS_MM.length) / 2,
  },
  {
    name: "discardHolder",
    centre: DEALER_STATION_LAYOUT.discardHolder,
    halfWidth: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.width) / 2,
    halfDepth: millimetresToMetres(DISCARD_HOLDER_DIMENSIONS_MM.depth) / 2,
  },
  {
    name: "limitSign",
    centre: DEALER_STATION_LAYOUT.limitSign,
    halfWidth: millimetresToMetres(LIMIT_SIGN_DIMENSIONS_MM.width) / 2,
    halfDepth: millimetresToMetres(LIMIT_SIGN_DIMENSIONS_MM.height) / 2,
  },
] as const;

for (const variant of ["mass", "vip"] as const) {
  const seats = computeSeatPlacements(variant);
  let worstGuestMargin = Number.POSITIVE_INFINITY;
  let worstDealerMargin = Number.POSITIVE_INFINITY;
  let worstLateralMargin = Number.POSITIVE_INFINITY;

  for (const seat of seats) {
    for (const spot of REFERENCE_BET_SPOTS) {
      for (const corner of computeBetSpotCorners(seat, spot)) {
        worstGuestMargin = Math.min(
          worstGuestMargin,
          computeFeltGuestEdgeZ(corner.x) - corner.z,
        );
        worstDealerMargin = Math.min(
          worstDealerMargin,
          corner.z - FELT_DEALER_EDGE_Z,
        );
        worstLateralMargin = Math.min(
          worstLateralMargin,
          FELT_INSET.halfWidth - Math.abs(corner.x),
        );
      }
    }
  }

  let worstSpacing = Number.POSITIVE_INFINITY;
  for (let index = 1; index < seats.length; index += 1) {
    const previous = seats[index - 1];
    const current = seats[index];
    if (previous === undefined || current === undefined) continue;
    worstSpacing = Math.min(
      worstSpacing,
      Math.hypot(current.x - previous.x, current.z - previous.z),
    );
  }

  let worstPropClearance = Number.POSITIVE_INFINITY;
  let worstPropName = "";
  for (const seat of seats) {
    for (const spot of REFERENCE_BET_SPOTS) {
      const corners = computeBetSpotCorners(seat, spot);
      const spotMinX = Math.min(...corners.map((corner) => corner.x));
      const spotMaxX = Math.max(...corners.map((corner) => corner.x));
      const spotMinZ = Math.min(...corners.map((corner) => corner.z));
      const spotMaxZ = Math.max(...corners.map((corner) => corner.z));

      for (const prop of PROP_FOOTPRINTS) {
        const propMinX = prop.centre.x - prop.halfWidth;
        const propMaxX = prop.centre.x + prop.halfWidth;
        const propMinZ = prop.centre.z - prop.halfDepth;
        const propMaxZ = prop.centre.z + prop.halfDepth;

        // Positive when the boxes are apart on that axis.
        const gapX = Math.max(propMinX - spotMaxX, spotMinX - propMaxX);
        const gapZ = Math.max(propMinZ - spotMaxZ, spotMinZ - propMaxZ);
        const separation = Math.max(gapX, gapZ);
        if (separation < worstPropClearance) {
          worstPropClearance = separation;
          worstPropName = `${prop.name} vs seat ${seat.label} ${spot.id}`;
        }
      }
    }
  }

  console.log(`--- ${variant} ---`);
  console.log("guest margin  mm:", Math.round(worstGuestMargin * 1000));
  console.log(
    "prop clearance mm:",
    Math.round(worstPropClearance * 1000),
    `(${worstPropName})`,
  );
  console.log("dealer margin mm:", Math.round(worstDealerMargin * 1000));
  console.log("lateral margin mm:", Math.round(worstLateralMargin * 1000));
  console.log("min centre spacing mm:", Math.round(worstSpacing * 1000));
  console.log("needs spacing >     :", Math.round(SEAT_BLOCK.boxWidth * 1000));
  console.log(
    "seats:",
    seats
      .map(
        (seat) =>
          `${seat.label}(x=${seat.x.toFixed(2)},z=${seat.z.toFixed(2)},${Math.round(
            (seat.facingRadians * 180) / Math.PI,
          )}°)`,
      )
      .join(" "),
  );
}
