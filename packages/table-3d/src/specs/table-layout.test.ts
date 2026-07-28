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
  getSeatLabels,
  MASS_SEAT_LABELS,
  SEAT_BLOCK,
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

  it("does not overlap neighbouring blocks", () => {
    const seats = computeSeatPlacements("mass");
    for (let seatIndex = 1; seatIndex < seats.length; seatIndex += 1) {
      const previousSeat = seats[seatIndex - 1];
      const currentSeat = seats[seatIndex];
      if (previousSeat === undefined || currentSeat === undefined) {
        continue;
      }
      const centreSpacing = Math.hypot(
        currentSeat.x - previousSeat.x,
        currentSeat.z - previousSeat.z,
      );
      expect(centreSpacing).toBeGreaterThan(SEAT_BLOCK.boxWidth);
    }
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
