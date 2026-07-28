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
  computeSeatPlacements,
  DEALER_STATION_LAYOUT,
  getSeatLabels,
  MASS_SEAT_LABELS,
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
