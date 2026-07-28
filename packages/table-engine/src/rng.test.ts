/**
 * Seeded RNG tests.
 *
 * The whole point of a seeded RNG is reproducibility: the same seed must always
 * produce the same sequence, and different seeds must (in practice) diverge.
 * Replay and grading depend on this, so it is locked here.
 */
import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng.js";

describe("createSeededRng", () => {
  it("produces the same sequence for the same seed", () => {
    const first = createSeededRng("shoe-seed-1");
    const second = createSeededRng("shoe-seed-1");
    const firstValues = Array.from({ length: 10 }, () => first.nextFloat());
    const secondValues = Array.from({ length: 10 }, () => second.nextFloat());
    expect(firstValues).toEqual(secondValues);
  });

  it("produces different sequences for different seeds", () => {
    const first = createSeededRng("seed-a");
    const second = createSeededRng("seed-b");
    const firstValues = Array.from({ length: 10 }, () => first.nextFloat());
    const secondValues = Array.from({ length: 10 }, () => second.nextFloat());
    expect(firstValues).not.toEqual(secondValues);
  });

  it("returns floats in the half-open range [0, 1)", () => {
    const rng = createSeededRng("range-seed");
    for (let draw = 0; draw < 1000; draw += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns integers in [0, bound) via nextInt", () => {
    const rng = createSeededRng("int-seed");
    for (let draw = 0; draw < 1000; draw += 1) {
      const value = rng.nextInt(52);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(52);
    }
  });
});
