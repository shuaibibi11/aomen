/**
 * Table body geometry tests.
 *
 * These assert on the geometry that actually reaches the GPU, not on the layout
 * constants. That distinction matters: the layout module can be perfectly
 * self-consistent while the extruded mesh faces the wrong way or spans the wrong
 * depth, and only these tests would notice.
 *
 * The dealer side is identified by an intrinsic property rather than by our sign
 * convention: the dealer edge is a straight line, so many vertices share one Z
 * value there, while the guest arc's Z varies with X. If the whole convention
 * were inverted, the flat-side assertion below would fail.
 */
import { describe, expect, it } from "vitest";
import {
  buildFeltGeometry,
  buildTableOutlinePoints,
} from "./table-body.js";
import {
  computeFeltGuestEdgeZ,
  FELT_DEALER_EDGE_Z,
  FELT_INSET,
  TABLE_SIZE,
} from "../specs/table-layout.js";

const FELT_THICKNESS = 0.003;

function buildTestFelt() {
  return buildFeltGeometry(
    FELT_INSET.halfWidth,
    FELT_INSET.depth,
    FELT_THICKNESS,
  );
}

/**
 * Measure how wide the geometry is at its extreme Z values.
 *
 * This is the intrinsic way to tell the two edges apart: the flat dealer edge is
 * a straight line spanning the whole width at one Z, while the curved guest edge
 * narrows to a point at its apex. Vertex counts cannot be used for this, because
 * the sine curve is nearly flat near the apex and produces many vertices at
 * almost the same Z.
 */
function measureWidthAtExtremeZ(
  geometry: ReturnType<typeof buildTestFelt>,
): { widthAtMinZ: number; widthAtMaxZ: number } {
  const positionAttribute = geometry.getAttribute("position");
  const tolerance = 0.001;

  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positionAttribute.count; index += 1) {
    const vertexZ = positionAttribute.getZ(index);
    minZ = Math.min(minZ, vertexZ);
    maxZ = Math.max(maxZ, vertexZ);
  }

  const measureWidthNear = (targetZ: number): number => {
    let smallestX = Number.POSITIVE_INFINITY;
    let largestX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < positionAttribute.count; index += 1) {
      if (Math.abs(positionAttribute.getZ(index) - targetZ) > tolerance) {
        continue;
      }
      const vertexX = positionAttribute.getX(index);
      smallestX = Math.min(smallestX, vertexX);
      largestX = Math.max(largestX, vertexX);
    }
    return largestX - smallestX;
  };

  return {
    widthAtMinZ: measureWidthNear(minZ),
    widthAtMaxZ: measureWidthNear(maxZ),
  };
}

describe("felt geometry extent", () => {
  it("spans the full declared felt depth", () => {
    const geometry = buildTestFelt();
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    expect(boundingBox).not.toBeNull();
    if (boundingBox === null) {
      return;
    }
    const spanZ = boundingBox.max.z - boundingBox.min.z;
    expect(spanZ).toBeCloseTo(FELT_INSET.depth, 4);
  });

  it("spans the full declared felt width", () => {
    const geometry = buildTestFelt();
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    expect(boundingBox).not.toBeNull();
    if (boundingBox === null) {
      return;
    }
    const spanX = boundingBox.max.x - boundingBox.min.x;
    expect(spanX).toBeCloseTo(FELT_INSET.halfWidth * 2, 4);
  });

  it("lies flat, with vertical extent equal to the slab thickness", () => {
    const geometry = buildTestFelt();
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    expect(boundingBox).not.toBeNull();
    if (boundingBox === null) {
      return;
    }
    const spanY = boundingBox.max.y - boundingBox.min.y;
    expect(spanY).toBeCloseTo(FELT_THICKNESS, 5);
  });

  it("stays inside the table footprint", () => {
    const geometry = buildTestFelt();
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    expect(boundingBox).not.toBeNull();
    if (boundingBox === null) {
      return;
    }
    expect(boundingBox.max.x).toBeLessThan(TABLE_SIZE.width / 2);
    expect(boundingBox.min.x).toBeGreaterThan(-TABLE_SIZE.width / 2);
  });
});

describe("felt geometry orientation", () => {
  /**
   * The dealer edge spans the whole table width at a single Z, while the guest
   * apex narrows to a point. Comparing those widths identifies the flat side
   * without relying on our own sign convention, so an inverted table would fail
   * this assertion.
   */
  it("puts the flat edge on the negative-Z side", () => {
    const geometry = buildTestFelt();
    const { widthAtMinZ, widthAtMaxZ } = measureWidthAtExtremeZ(geometry);

    // Min Z is the dealer side, so it must be the wide, straight edge.
    expect(widthAtMinZ).toBeGreaterThan(widthAtMaxZ);
    expect(widthAtMinZ).toBeCloseTo(FELT_INSET.halfWidth * 2, 3);
  });

  it("narrows to a point at the guest apex", () => {
    const geometry = buildTestFelt();
    const { widthAtMaxZ } = measureWidthAtExtremeZ(geometry);
    // The apex is a single outline point, so its width is a rounding artefact.
    expect(widthAtMaxZ).toBeLessThan(FELT_INSET.halfWidth * 0.25);
  });

  it("puts the curved edge on the positive-Z side", () => {
    const geometry = buildTestFelt();
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    expect(boundingBox).not.toBeNull();
    if (boundingBox === null) {
      return;
    }
    // The guest apex is the furthest point from the dealer edge.
    expect(boundingBox.max.z).toBeGreaterThan(0);
    expect(Math.abs(boundingBox.max.z)).toBeGreaterThan(
      Math.abs(boundingBox.min.z),
    );
  });

  it("keeps the dealer edge straight and the guest edge curved", () => {
    const outlinePoints = buildTableOutlinePoints(
      FELT_INSET.halfWidth,
      FELT_INSET.depth,
    );

    // In outline space, +Y is the dealer edge. Sample the extreme rows.
    const maxOutlineY = Math.max(...outlinePoints.map((point) => point.y));
    const minOutlineY = Math.min(...outlinePoints.map((point) => point.y));

    const dealerRow = outlinePoints.filter(
      (point) => Math.abs(point.y - maxOutlineY) < 1e-6,
    );
    const guestApexRow = outlinePoints.filter(
      (point) => Math.abs(point.y - minOutlineY) < 1e-6,
    );

    // The dealer edge spans the full width at one Y; the guest apex is a point.
    expect(dealerRow.length).toBeGreaterThan(guestApexRow.length);
  });
});

/**
 * The felt-edge helper duplicates the outline maths. If the two drift apart,
 * seat blocks would be validated against a boundary the mesh does not have.
 */
describe("felt edge helper matches the real outline", () => {
  it("agrees with the outline vertices across the width", () => {
    const outlinePoints = buildTableOutlinePoints(
      FELT_INSET.halfWidth,
      FELT_INSET.depth,
    );

    // Outline Y maps to world Z with a sign flip after rotateX(-π/2).
    for (const sampleFraction of [0, 0.25, 0.5, 0.75, 0.95]) {
      const sampleX = FELT_INSET.halfWidth * sampleFraction;

      // Find the outline point nearest this X on the guest arc (negative Y).
      const guestArcPoints = outlinePoints.filter((point) => point.y < 0);
      let nearestPoint = guestArcPoints[0];
      if (nearestPoint === undefined) {
        throw new Error("Outline has no guest-arc points");
      }
      for (const point of guestArcPoints) {
        if (
          Math.abs(point.x - sampleX) < Math.abs(nearestPoint.x - sampleX)
        ) {
          nearestPoint = point;
        }
      }

      const outlineWorldZ = -nearestPoint.y;
      const helperWorldZ = computeFeltGuestEdgeZ(nearestPoint.x);
      expect(helperWorldZ).toBeCloseTo(outlineWorldZ, 3);
    }
  });

  it("agrees with the outline on the dealer edge", () => {
    const outlinePoints = buildTableOutlinePoints(
      FELT_INSET.halfWidth,
      FELT_INSET.depth,
    );
    const maxOutlineY = Math.max(...outlinePoints.map((point) => point.y));
    expect(FELT_DEALER_EDGE_Z).toBeCloseTo(-maxOutlineY, 6);
  });
});
