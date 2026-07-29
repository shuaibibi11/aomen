/**
 * Table layout tests.
 *
 * These lock the items from the reproduction checklist in the real-table spec:
 * the dealer is on the flat edge, guests are on the curved edge, seat art faces
 * the guest, and big tables skip seat 13.
 */
import { describe, expect, it } from "vitest";
import {
  BIG_TABLE_SEAT_LABELS,
  computeBetSpotPosition,
  computeFeltGuestEdgeZ,
  computePlayerBoxPosition,
  computeSeatPlacements,
  DEALER_STATION_LAYOUT,
  FELT_DEALER_EDGE_Z,
  FELT_INSET,
  findBetSpotAtWorldPosition,
  getSeatLabels,
  MASS_SEAT_LABELS,
  REFERENCE_BET_SPOTS,
  SEAT_BLOCK,
  seatLocalToWorld,
  worldToSeatLocal,
  SEAT_BLOCK_DEALER_REACH,
  SEAT_BLOCK_GUEST_REACH,
  TABLE_DIMENSIONS_MM,
  TABLE_SIZE,
  VIP_SEAT_LABELS,
} from "./table-layout.js";

describe("table dimensions", () => {
  it("is wider than it is deep, like a real kidney table", () => {
    expect(TABLE_DIMENSIONS_MM.width).toBeGreaterThan(TABLE_DIMENSIONS_MM.depth);
  });

  it("sits at a standard casino table height", () => {
    expect(TABLE_DIMENSIONS_MM.surfaceHeight).toBeGreaterThanOrEqual(700);
    expect(TABLE_DIMENSIONS_MM.surfaceHeight).toBeLessThanOrEqual(820);
  });

  it("converts the footprint to metres", () => {
    expect(TABLE_SIZE.width).toBeCloseTo(2.4, 6);
    expect(TABLE_SIZE.depth).toBeCloseTo(1.4, 6);
  });
});

describe("seat numbering", () => {
  it("gives the mass hall seven seats", () => {
    expect(MASS_SEAT_LABELS).toHaveLength(7);
  });

  it("gives the VIP room fewer seats than the mass hall", () => {
    expect(VIP_SEAT_LABELS.length).toBeLessThan(MASS_SEAT_LABELS.length);
  });

  it("skips seat 13 on a big table", () => {
    expect(BIG_TABLE_SEAT_LABELS).not.toContain(13);
    expect(BIG_TABLE_SEAT_LABELS).toContain(12);
    expect(BIG_TABLE_SEAT_LABELS).toContain(14);
  });

  it("selects labels by hall type", () => {
    expect(getSeatLabels("mass")).toEqual(MASS_SEAT_LABELS);
    expect(getSeatLabels("vip")).toEqual(VIP_SEAT_LABELS);
  });
});

describe("seat placement on the guest arc", () => {
  it("creates one placement per seat", () => {
    expect(computeSeatPlacements("mass")).toHaveLength(MASS_SEAT_LABELS.length);
    expect(computeSeatPlacements("vip")).toHaveLength(VIP_SEAT_LABELS.length);
  });

  it("puts every seat on the guest side, away from the dealer", () => {
    for (const seat of computeSeatPlacements("mass")) {
      expect(seat.z).toBeGreaterThan(0);
    }
  });

  it("keeps the dealer station on the opposite side from the guests", () => {
    expect(DEALER_STATION_LAYOUT.chipTray.z).toBeLessThan(0);
    expect(DEALER_STATION_LAYOUT.dealingShoe.z).toBeLessThan(0);
    expect(DEALER_STATION_LAYOUT.roadmapMonitor.z).toBeLessThan(0);
  });

  it("orders seats left to right across the table", () => {
    const xPositions = computeSeatPlacements("mass").map((seat) => seat.x);
    const sorted = [...xPositions].sort((left, right) => left - right);
    expect(xPositions).toEqual(sorted);
  });

  it("mirrors the outer seats about the table centre", () => {
    const seats = computeSeatPlacements("mass");
    const firstSeat = seats[0];
    const lastSeat = seats[seats.length - 1];
    expect(firstSeat).toBeDefined();
    expect(lastSeat).toBeDefined();
    if (firstSeat === undefined || lastSeat === undefined) {
      return;
    }
    expect(firstSeat.x).toBeCloseTo(-lastSeat.x, 6);
    expect(firstSeat.z).toBeCloseTo(lastSeat.z, 6);
  });

  it("keeps the middle seat on the centre line", () => {
    const seats = computeSeatPlacements("mass");
    const middleSeat = seats[Math.floor(seats.length / 2)];
    expect(middleSeat).toBeDefined();
    if (middleSeat === undefined) {
      return;
    }
    expect(middleSeat.x).toBeCloseTo(0, 6);
    expect(middleSeat.facingRadians).toBeCloseTo(0, 6);
  });

  it("turns left-hand seats and right-hand seats in opposite directions", () => {
    const seats = computeSeatPlacements("mass");
    const leftSeat = seats[0];
    const rightSeat = seats[seats.length - 1];
    expect(leftSeat).toBeDefined();
    expect(rightSeat).toBeDefined();
    if (leftSeat === undefined || rightSeat === undefined) {
      return;
    }
    expect(Math.sign(leftSeat.facingRadians)).toBe(-Math.sign(rightSeat.facingRadians));
  });

  it("keeps every seat inside the table footprint", () => {
    for (const seat of computeSeatPlacements("mass")) {
      expect(Math.abs(seat.x)).toBeLessThan(TABLE_SIZE.width / 2);
      expect(seat.z).toBeLessThan(TABLE_SIZE.depth);
    }
  });
});

/**
 * The printed block has to sit on the cloth, not on the padded rail. These are
 * the tests that caught the seat arc being too large for the felt.
 */
describe("printed seat blocks fit on the felt", () => {
  it("insets the felt from the table outline on every side", () => {
    expect(FELT_INSET.halfWidth).toBeLessThan(TABLE_SIZE.width / 2);
    expect(FELT_INSET.depth).toBeLessThan(TABLE_SIZE.depth);
  });

  it("puts the felt dealer edge on the dealer side of the centre line", () => {
    expect(FELT_DEALER_EDGE_Z).toBeLessThan(0);
  });

  it("reaches furthest towards the guest at the centre of the arc", () => {
    expect(computeFeltGuestEdgeZ(0)).toBeGreaterThan(
      computeFeltGuestEdgeZ(FELT_INSET.halfWidth * 0.9),
    );
  });

  for (const variant of ["mass", "vip"] as const) {
    it(`keeps the guest edge of every ${variant} block on the cloth`, () => {
      for (const seat of computeSeatPlacements(variant)) {
        const feltEdgeZ = computeFeltGuestEdgeZ(seat.x);
        expect(seat.z + SEAT_BLOCK_GUEST_REACH).toBeLessThan(feltEdgeZ);
      }
    });

    it(`keeps the dealer edge of every ${variant} block on the cloth`, () => {
      for (const seat of computeSeatPlacements(variant)) {
        expect(seat.z - SEAT_BLOCK_DEALER_REACH).toBeGreaterThan(
          FELT_DEALER_EDGE_Z,
        );
      }
    });

    it(`keeps every ${variant} block within the felt half-width`, () => {
      for (const seat of computeSeatPlacements(variant)) {
        const blockHalfWidth = SEAT_BLOCK.boxWidth / 2;
        expect(Math.abs(seat.x) + blockHalfWidth).toBeLessThan(
          FELT_INSET.halfWidth,
        );
      }
    });
  }

  /**
   * Comparing seat spacing against the box width is not enough: the blocks are
   * fanned, so a rotated block reaches further sideways than its own width. This
   * checks every spot centre resolves to its own seat, which is the property that
   * actually matters for attributing a click, and it is what caught seat 7's
   * pair circle sitting inside seat 6's BANKER box.
   */
  it("does not overlap neighbouring blocks", () => {
    for (const variant of ["mass", "vip"] as const) {
      const seats = computeSeatPlacements(variant);
      for (const seat of seats) {
        for (const spot of REFERENCE_BET_SPOTS) {
          const world = seatLocalToWorld(seat, spot.localX, spot.localZ);
          const hit = findBetSpotAtWorldPosition(world.x, world.z, seats);
          expect(hit?.seatLabel).toBe(seat.label);
          expect(hit?.spotId).toBe(spot.id);
        }
      }
    }
  });
});

/**
 * Hit testing is what turns a click into a `place_bet` intent, so it has to
 * agree exactly with the transform the felt texture drew the spot with.
 */
describe("bet spot hit testing", () => {
  const massSeats = computeSeatPlacements("mass");

  it("round-trips every spot centre back to its own spot", () => {
    for (const seat of massSeats) {
      for (const spot of REFERENCE_BET_SPOTS) {
        const worldPosition = seatLocalToWorld(seat, spot.localX, spot.localZ);
        const hit = findBetSpotAtWorldPosition(
          worldPosition.x,
          worldPosition.z,
          massSeats,
        );
        expect(hit).not.toBeNull();
        expect(hit?.seatLabel).toBe(seat.label);
        expect(hit?.spotId).toBe(spot.id);
      }
    }
  });

  it("inverts the seat rotation exactly", () => {
    for (const seat of massSeats) {
      const world = seatLocalToWorld(seat, 0.031, -0.072);
      const local = worldToSeatLocal(seat, world.x, world.z);
      expect(local.localX).toBeCloseTo(0.031, 9);
      expect(local.localZ).toBeCloseTo(-0.072, 9);
    }
  });

  it("returns null for a point on bare felt", () => {
    // Far behind every block, near the dealer edge.
    const hit = findBetSpotAtWorldPosition(0, FELT_DEALER_EDGE_Z * 0.9, massSeats);
    expect(hit).toBeNull();
  });

  it("returns null in the gap between two stacked boxes", () => {
    const seat = massSeats[Math.floor(massSeats.length / 2)];
    expect(seat).toBeDefined();
    if (seat === undefined) {
      return;
    }
    const playerSpot = REFERENCE_BET_SPOTS.find((spot) => spot.id === "player");
    const bankerSpot = REFERENCE_BET_SPOTS.find((spot) => spot.id === "banker");
    expect(playerSpot).toBeDefined();
    expect(bankerSpot).toBeDefined();
    if (playerSpot === undefined || bankerSpot === undefined) {
      return;
    }

    // Midway between the two box edges falls in the printed gap.
    const playerInnerEdge = playerSpot.localZ - playerSpot.depth / 2;
    const bankerOuterEdge = bankerSpot.localZ + bankerSpot.depth / 2;
    const gapCentreLocalZ = (playerInnerEdge + bankerOuterEdge) / 2;
    const world = seatLocalToWorld(seat, 0, gapCentreLocalZ);

    expect(findBetSpotAtWorldPosition(world.x, world.z, massSeats)).toBeNull();
  });

  it("treats the pair circles as circles, not their bounding squares", () => {
    const seat = massSeats[Math.floor(massSeats.length / 2)];
    const pairSpot = REFERENCE_BET_SPOTS.find(
      (spot) => spot.id === "player_pair",
    );
    expect(seat).toBeDefined();
    expect(pairSpot).toBeDefined();
    if (seat === undefined || pairSpot === undefined) {
      return;
    }

    // A point just inside the bounding square's corner is outside the circle.
    const cornerOffset = pairSpot.radius * 0.9;
    const world = seatLocalToWorld(
      seat,
      pairSpot.localX + cornerOffset,
      pairSpot.localZ + cornerOffset,
    );
    const hit = findBetSpotAtWorldPosition(world.x, world.z, massSeats);
    expect(hit?.spotId).not.toBe("player_pair");
  });

  it("maps a click to the seat whose block it is inside", () => {
    const leftSeat = massSeats[0];
    const rightSeat = massSeats[massSeats.length - 1];
    expect(leftSeat).toBeDefined();
    expect(rightSeat).toBeDefined();
    if (leftSeat === undefined || rightSeat === undefined) {
      return;
    }

    const leftWorld = computeBetSpotPosition(leftSeat, "banker");
    const rightWorld = computeBetSpotPosition(rightSeat, "banker");

    expect(
      findBetSpotAtWorldPosition(leftWorld.x, leftWorld.z, massSeats)?.seatLabel,
    ).toBe(leftSeat.label);
    expect(
      findBetSpotAtWorldPosition(rightWorld.x, rightWorld.z, massSeats)?.seatLabel,
    ).toBe(rightSeat.label);
  });
});

describe("player box positions", () => {
  /**
   * The seat position marks the guest edge of the printed block, so every spot
   * sits inwards from it. PLAYER is the nearest betting box to the guest, so it
   * must be inside the seat edge but still outside BANKER.
   */
  it("sits just inside the seat's guest edge", () => {
    for (const seat of computeSeatPlacements("mass")) {
      const playerBox = computePlayerBoxPosition(seat);
      expect(playerBox.z).toBeLessThan(seat.z);
    }
  });

  it("sits closer to the guest than the banker box", () => {
    for (const seat of computeSeatPlacements("mass")) {
      const playerBox = computeBetSpotPosition(seat, "player");
      const bankerBox = computeBetSpotPosition(seat, "banker");
      expect(playerBox.z).toBeGreaterThan(bankerBox.z);
    }
  });

  it("keeps tie furthest from the guest of the three main bets", () => {
    for (const seat of computeSeatPlacements("mass")) {
      const bankerBox = computeBetSpotPosition(seat, "banker");
      const tieBox = computeBetSpotPosition(seat, "tie");
      expect(tieBox.z).toBeLessThan(bankerBox.z);
    }
  });

  it("stays on the cloth", () => {
    for (const seat of computeSeatPlacements("mass")) {
      const playerBox = computePlayerBoxPosition(seat);
      expect(playerBox.z).toBeLessThan(computeFeltGuestEdgeZ(playerBox.x));
      expect(Math.abs(playerBox.x)).toBeLessThan(FELT_INSET.halfWidth);
    }
  });

  it("shifts outer boxes laterally because their blocks are rotated", () => {
    const seats = computeSeatPlacements("mass");
    const rightSeat = seats[seats.length - 1];
    expect(rightSeat).toBeDefined();
    if (rightSeat === undefined) {
      return;
    }
    expect(computePlayerBoxPosition(rightSeat).x).toBeLessThan(rightSeat.x);
  });
});
