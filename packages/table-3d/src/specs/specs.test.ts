/**
 * Guard the numbers that make the models physically correct, and guard the
 * promise that no two casinos share the same chip or card styling.
 */
import { describe, expect, it } from "vitest";
import {
  CARD_DIMENSIONS_MM,
  CARD_SIZE,
  CHIP_DIMENSIONS_MM,
  CHIP_SIZE,
  CHIP_STACK_COUNT,
  CARDS_PER_SHOE,
  millimetresToMetres,
} from "./dimensions.js";
import {
  CASINO_IDS,
  getAllCasinoThemes,
  getCasinoMonogram,
  getCasinoTheme,
} from "./casino-theme.js";
import { getMouldProfile, MOULD_PROFILES } from "./denominations.js";

describe("unit conversion", () => {
  it("converts millimetres to scene metres", () => {
    expect(millimetresToMetres(1000)).toBe(1);
    expect(millimetresToMetres(39)).toBeCloseTo(0.039, 6);
  });
});

describe("chip dimensions", () => {
  it("uses the standard 39 mm casino chip", () => {
    expect(CHIP_DIMENSIONS_MM.diameter).toBe(39);
    expect(CHIP_SIZE.radius).toBeCloseTo(0.0195, 6);
  });

  it("keeps the disc far wider than it is thick", () => {
    const aspectRatio = CHIP_DIMENSIONS_MM.diameter / CHIP_DIMENSIONS_MM.thickness;
    expect(aspectRatio).toBeGreaterThan(10);
  });

  it("keeps the rim chamfer smaller than half the thickness", () => {
    expect(CHIP_SIZE.rimChamfer).toBeLessThan(CHIP_SIZE.thickness / 2);
  });

  it("counts a dealer stack as twenty chips", () => {
    expect(CHIP_STACK_COUNT).toBe(20);
  });
});

describe("card dimensions", () => {
  it("uses bridge size rather than poker size", () => {
    expect(CARD_DIMENSIONS_MM.width).toBe(57);
    expect(CARD_DIMENSIONS_MM.height).toBe(89);
  });

  it("is taller than it is wide", () => {
    expect(CARD_SIZE.height).toBeGreaterThan(CARD_SIZE.width);
  });

  it("keeps the corner radius inside half the card width", () => {
    expect(CARD_SIZE.cornerRadius).toBeLessThan(CARD_SIZE.width / 2);
  });

  it("models an eight-deck shoe", () => {
    expect(CARDS_PER_SHOE).toBe(416);
  });
});

describe("casino themes", () => {
  it("exposes six casinos", () => {
    expect(CASINO_IDS).toHaveLength(6);
  });

  it("loads a theme for every id", () => {
    for (const casinoId of CASINO_IDS) {
      const theme = getCasinoTheme(casinoId);
      expect(theme.casinoId).toBe(casinoId);
      expect(theme.chipDenominations.length).toBeGreaterThan(0);
    }
  });

  it("gives every casino a monogram", () => {
    for (const casinoId of CASINO_IDS) {
      expect(getCasinoMonogram(casinoId)).toMatch(/^[A-Z]$/);
    }
  });

  it("gives every casino a distinct chip mould", () => {
    const moulds = getAllCasinoThemes().map((theme) => theme.materials.chipMould);
    expect(new Set(moulds).size).toBe(moulds.length);
  });

  it("gives every casino a distinct card engraving", () => {
    const engravings = getAllCasinoThemes().map(
      (theme) => theme.materials.cardEngrave,
    );
    expect(new Set(engravings).size).toBe(engravings.length);
  });

  it("defines a mould profile for every chip mould in use", () => {
    for (const theme of getAllCasinoThemes()) {
      expect(MOULD_PROFILES[theme.materials.chipMould]).toBeDefined();
    }
  });

  it("uses a plausible number of rim inserts", () => {
    for (const theme of getAllCasinoThemes()) {
      expect(theme.materials.chipInserts).toBeGreaterThanOrEqual(3);
      expect(theme.materials.chipInserts).toBeLessThanOrEqual(24);
    }
  });
});

describe("mould profiles", () => {
  it("falls back safely for an unknown mould", () => {
    const profile = getMouldProfile("not-a-real-mould");
    expect(profile.chamferScale).toBeGreaterThan(0);
  });

  it("keeps insert width inside its slot", () => {
    for (const profile of Object.values(MOULD_PROFILES)) {
      expect(profile.insertWidthRatio).toBeGreaterThan(0);
      expect(profile.insertWidthRatio).toBeLessThan(1);
    }
  });

  it("makes square-edge flatter than bevel", () => {
    const squareEdge = getMouldProfile("square-edge");
    const bevel = getMouldProfile("bevel");
    expect(squareEdge.chamferScale).toBeLessThan(bevel.chamferScale);
  });
});
