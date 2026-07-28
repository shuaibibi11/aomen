import { describe, expect, it } from "vitest";
import { baccaratCardValue, baccaratHandTotal, type Card } from "./cards.js";

function card(rank: Card["rank"], suit: Card["suit"] = "spade"): Card {
  return { rank, suit };
}

describe("baccaratCardValue", () => {
  it("counts an ace as one", () => {
    expect(baccaratCardValue(card("A"))).toBe(1);
  });

  it("counts pip cards at face value", () => {
    expect(baccaratCardValue(card("2"))).toBe(2);
    expect(baccaratCardValue(card("9"))).toBe(9);
  });

  it("counts ten and court cards as zero", () => {
    expect(baccaratCardValue(card("10"))).toBe(0);
    expect(baccaratCardValue(card("J"))).toBe(0);
    expect(baccaratCardValue(card("Q"))).toBe(0);
    expect(baccaratCardValue(card("K"))).toBe(0);
  });

  it("ignores suit", () => {
    expect(baccaratCardValue(card("7", "heart"))).toBe(
      baccaratCardValue(card("7", "club")),
    );
  });
});

describe("baccaratHandTotal", () => {
  it("is zero for an empty hand", () => {
    expect(baccaratHandTotal([])).toBe(0);
  });

  it("takes only the last digit of the sum", () => {
    // 9 + 8 = 17 → 7
    expect(baccaratHandTotal([card("9"), card("8")])).toBe(7);
  });

  it("treats a king as zero", () => {
    expect(baccaratHandTotal([card("K")])).toBe(0);
  });

  it("makes a natural nine", () => {
    expect(baccaratHandTotal([card("4"), card("5")])).toBe(9);
  });

  it("wraps a three-card total", () => {
    // 6 + 6 + 6 = 18 → 8
    expect(baccaratHandTotal([card("6"), card("6"), card("6")])).toBe(8);
  });

  it("counts a ten-and-court hand as zero", () => {
    expect(baccaratHandTotal([card("10"), card("Q")])).toBe(0);
  });
});
