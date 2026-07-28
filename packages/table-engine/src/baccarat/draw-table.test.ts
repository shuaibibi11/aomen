/**
 * Baccarat third-card (drawing) rule tests.
 *
 * These lock the fixed rules of the game. They are the correctness core of the
 * whole system: if the draw table is wrong, the trainer teaches the wrong
 * procedure, so every branch of the banker table is covered explicitly.
 *
 * Rules under test:
 *   - Natural: a two-card total of 8 or 9 ends the hand for both sides.
 *   - Player: draws a third card on 0-5, stands on 6-7.
 *   - Banker: if the player stood, the banker plays like the player (draw 0-5,
 *     stand 6-7). If the player drew, the banker's action depends on the banker
 *     total and the pip value of the player's third card.
 */
import { describe, expect, it } from "vitest";
import {
  bankerDrawsThird,
  isNatural,
  playerDrawsThird,
} from "./draw-table.js";

describe("isNatural", () => {
  it("is true for a two-card total of 8", () => {
    expect(isNatural(8)).toBe(true);
  });

  it("is true for a two-card total of 9", () => {
    expect(isNatural(9)).toBe(true);
  });

  it("is false for totals below 8", () => {
    for (let total = 0; total <= 7; total += 1) {
      expect(isNatural(total)).toBe(false);
    }
  });
});

describe("playerDrawsThird", () => {
  it("draws on totals 0 through 5", () => {
    for (let total = 0; total <= 5; total += 1) {
      expect(playerDrawsThird(total)).toBe(true);
    }
  });

  it("stands on 6 and 7", () => {
    expect(playerDrawsThird(6)).toBe(false);
    expect(playerDrawsThird(7)).toBe(false);
  });
});

describe("bankerDrawsThird when the player stood", () => {
  // playerThirdCard === null means the player did not take a third card.
  it("draws on 0 through 5", () => {
    for (let total = 0; total <= 5; total += 1) {
      expect(bankerDrawsThird(total, null)).toBe(true);
    }
  });

  it("stands on 6 and 7", () => {
    expect(bankerDrawsThird(6, null)).toBe(false);
    expect(bankerDrawsThird(7, null)).toBe(false);
  });
});

describe("bankerDrawsThird when the player drew a third card", () => {
  it("always draws on 0, 1 and 2", () => {
    for (let playerThird = 0; playerThird <= 9; playerThird += 1) {
      expect(bankerDrawsThird(0, playerThird)).toBe(true);
      expect(bankerDrawsThird(1, playerThird)).toBe(true);
      expect(bankerDrawsThird(2, playerThird)).toBe(true);
    }
  });

  it("on 3 draws unless the player's third card is 8", () => {
    for (let playerThird = 0; playerThird <= 9; playerThird += 1) {
      const expected = playerThird !== 8;
      expect(bankerDrawsThird(3, playerThird)).toBe(expected);
    }
  });

  it("on 4 draws when the player's third card is 2 through 7", () => {
    for (let playerThird = 0; playerThird <= 9; playerThird += 1) {
      const expected = playerThird >= 2 && playerThird <= 7;
      expect(bankerDrawsThird(4, playerThird)).toBe(expected);
    }
  });

  it("on 5 draws when the player's third card is 4 through 7", () => {
    for (let playerThird = 0; playerThird <= 9; playerThird += 1) {
      const expected = playerThird >= 4 && playerThird <= 7;
      expect(bankerDrawsThird(5, playerThird)).toBe(expected);
    }
  });

  it("on 6 draws when the player's third card is 6 or 7", () => {
    for (let playerThird = 0; playerThird <= 9; playerThird += 1) {
      const expected = playerThird === 6 || playerThird === 7;
      expect(bankerDrawsThird(6, playerThird)).toBe(expected);
    }
  });

  it("always stands on 7", () => {
    for (let playerThird = 0; playerThird <= 9; playerThird += 1) {
      expect(bankerDrawsThird(7, playerThird)).toBe(false);
    }
  });
});
