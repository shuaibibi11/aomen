/**
 * Guard the flat-slab geometry helper.
 *
 * The original implementation assumed ExtrudeGeometry was indexed. It is not,
 * so every material group was created with a count of zero and the cards,
 * plaques and membership cards silently rendered nothing. These tests assert
 * the group ranges actually cover the geometry.
 */
import { describe, expect, it } from "vitest";
import { buildFlatSlabGeometry } from "./flat-slab.js";

const SLAB_WIDTH = 0.0856;
const SLAB_HEIGHT = 0.05398;
const SLAB_THICKNESS = 0.00076;
const SLAB_CORNER_RADIUS = 0.00318;

function buildTestSlab() {
  return buildFlatSlabGeometry(
    SLAB_WIDTH,
    SLAB_HEIGHT,
    SLAB_THICKNESS,
    SLAB_CORNER_RADIUS,
  );
}

describe("flat slab geometry", () => {
  it("produces vertices", () => {
    const geometry = buildTestSlab();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("creates at least one group per material slot", () => {
    const geometry = buildTestSlab();
    const usedSlots = new Set(geometry.groups.map((group) => group.materialIndex));
    expect(usedSlots.has(0)).toBe(true);
    expect(usedSlots.has(1)).toBe(true);
    expect(usedSlots.has(2)).toBe(true);
  });

  it("gives every group a non-zero draw count", () => {
    const geometry = buildTestSlab();
    expect(geometry.groups.length).toBeGreaterThan(0);
    for (const group of geometry.groups) {
      expect(group.count).toBeGreaterThan(0);
    }
  });

  it("covers every vertex exactly once across all groups", () => {
    const geometry = buildTestSlab();
    const vertexCount = geometry.getAttribute("position").count;
    const totalCovered = geometry.groups.reduce(
      (runningTotal, group) => runningTotal + group.count,
      0,
    );
    expect(totalCovered).toBe(vertexCount);
  });

  it("orders groups contiguously from zero", () => {
    const geometry = buildTestSlab();
    let expectedStart = 0;
    for (const group of geometry.groups) {
      expect(group.start).toBe(expectedStart);
      expectedStart += group.count;
    }
  });

  it("keeps UVs inside the zero-to-one range", () => {
    const geometry = buildTestSlab();
    const uvAttribute = geometry.getAttribute("uv");
    for (let vertexIndex = 0; vertexIndex < uvAttribute.count; vertexIndex += 1) {
      expect(uvAttribute.getX(vertexIndex)).toBeGreaterThanOrEqual(-1e-6);
      expect(uvAttribute.getX(vertexIndex)).toBeLessThanOrEqual(1 + 1e-6);
      expect(uvAttribute.getY(vertexIndex)).toBeGreaterThanOrEqual(-1e-6);
      expect(uvAttribute.getY(vertexIndex)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("matches the requested outer dimensions", () => {
    const geometry = buildTestSlab();
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    expect(boundingBox).not.toBeNull();
    if (boundingBox === null) {
      return;
    }
    expect(boundingBox.max.x - boundingBox.min.x).toBeCloseTo(SLAB_WIDTH, 6);
    expect(boundingBox.max.y - boundingBox.min.y).toBeCloseTo(SLAB_HEIGHT, 6);
    expect(boundingBox.max.z - boundingBox.min.z).toBeCloseTo(SLAB_THICKNESS, 6);
  });
});
