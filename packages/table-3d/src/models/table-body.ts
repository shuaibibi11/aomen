/**
 * Kidney-shaped baccarat table body: felt surface, padded ring rail, apron
 * and legs.
 *
 * Orientation: dealer edge at -Z (positive Y in the outline), guest arc at
 * +Z (negative Y in the outline). After rotateX(-π/2) the Y axis maps to -Z,
 * so positive outline-Y becomes negative world-Z (dealer side) and negative
 * outline-Y becomes positive world-Z (guest side).
 */
import * as THREE from "three";
import type { CasinoTheme } from "../specs/casino-theme.js";
import { millimetresToMetres } from "../specs/dimensions.js";
import {
  computeOutlineWaist,
  FELT_INSET,
  OUTLINE_DEALER_DEPTH_RATIO,
  TABLE_SIZE,
} from "../specs/table-layout.js";

const OUTLINE_SEGMENTS = 96;

/**
 * Build the table outline in the XY plane.
 *   +Y  →  dealer edge   (flat, maps to -Z after rotation)
 *   -Y  →  guest arc far (maps to +Z after rotation)
 *
 * The waist factor pulls in near the dealer corners so the profile looks like a
 * kidney rather than a plain half-ellipse.
 */
export function buildTableOutlinePoints(
  halfWidth: number,
  depth: number,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  // The dealer edge sits at +34% of the depth, so the guest apex reaches the
  // remaining 66% on the other side of the centre line and the outline spans
  // the full declared depth.
  const dealerEdgeY = depth * OUTLINE_DEALER_DEPTH_RATIO;

  // Guest arc from right to left (x: +halfWidth → -halfWidth)
  for (let step = 0; step <= OUTLINE_SEGMENTS; step += 1) {
    const progress = step / OUTLINE_SEGMENTS;
    const angle = progress * Math.PI;
    const normalisedX = Math.cos(angle);
    const x = halfWidth * normalisedX;

    const y =
      dealerEdgeY
      - depth * Math.sin(angle) * computeOutlineWaist(normalisedX);
    points.push(new THREE.Vector2(x, y));
  }

  // Flat dealer edge closes the shape
  points.push(new THREE.Vector2(-halfWidth, dealerEdgeY));
  points.push(new THREE.Vector2(halfWidth, dealerEdgeY));

  return points;
}

function buildOutlineShape(halfWidth: number, depth: number): THREE.Shape {
  return new THREE.Shape(buildTableOutlinePoints(halfWidth, depth));
}

/**
 * Build the table outline as a ring: outer rail profile with the felt area cut
 * out as a hole. This lets the felt surface (which sits slightly higher) show
 * through rather than being buried under a solid slab.
 */
function buildRailRingGeometry(
  outerHalfWidth: number,
  outerDepth: number,
  innerHalfWidth: number,
  innerDepth: number,
  thickness: number,
): THREE.ExtrudeGeometry {
  const outerShape = buildOutlineShape(outerHalfWidth, outerDepth);

  // Inner hole must wind in the opposite direction so Three.js subtracts it.
  const innerPoints = buildTableOutlinePoints(innerHalfWidth, innerDepth);
  innerPoints.reverse();
  const holePath = new THREE.Path(innerPoints);
  outerShape.holes.push(holePath);

  const geometry = new THREE.ExtrudeGeometry(outerShape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * Build the flat felt slab whose top face carries the printed layout texture.
 * UVs are remapped from the XY bounding box so the texture covers the entire
 * footprint at a predictable scale.
 */
export function buildFeltGeometry(
  halfWidth: number,
  depth: number,
  thickness: number,
): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(
    buildOutlineShape(halfWidth, depth),
    { depth: thickness, bevelEnabled: false, curveSegments: 12 },
  );

  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox;

  if (boundingBox !== null) {
    const spanX = boundingBox.max.x - boundingBox.min.x;
    const spanY = boundingBox.max.y - boundingBox.min.y;
    for (let index = 0; index < positionAttribute.count; index += 1) {
      uvAttribute.setXY(
        index,
        (positionAttribute.getX(index) - boundingBox.min.x) / spanX,
        (positionAttribute.getY(index) - boundingBox.min.y) / spanY,
      );
    }
    uvAttribute.needsUpdate = true;
  }

  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export interface TableBodyOptions {
  readonly theme: CasinoTheme;
  /** Printed layout applied to the felt surface. */
  readonly layoutTexture: THREE.Texture;
}

export function createTableBody(options: TableBodyOptions): THREE.Group {
  const { theme, layoutTexture } = options;
  const table = new THREE.Group();
  table.name = "table-body";

  const halfWidth = TABLE_SIZE.width / 2;
  const depth = TABLE_SIZE.depth;
  const surfaceHeight = TABLE_SIZE.surfaceHeight;
  const railRise = TABLE_SIZE.railRise;

  const feltHalfWidth = FELT_INSET.halfWidth;
  const feltDepth = FELT_INSET.depth;

  // --- Ring-shaped padded rail (felt area is a hole) ---
  const railRingGeometry = buildRailRingGeometry(
    halfWidth,
    depth,
    feltHalfWidth,
    feltDepth,
    railRise + millimetresToMetres(6),
  );
  const railMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.rail,
    roughness: 0.42,
    metalness: 0.24,
  });
  const rail = new THREE.Mesh(railRingGeometry, railMaterial);
  rail.name = "table-rail";
  rail.position.y = surfaceHeight;
  rail.castShadow = true;
  rail.receiveShadow = true;
  table.add(rail);

  // --- Felt slab with printed layout on top ---
  const feltGeometry = buildFeltGeometry(
    feltHalfWidth,
    feltDepth,
    millimetresToMetres(3),
  );
  const feltMaterial = new THREE.MeshStandardMaterial({
    map: layoutTexture,
    roughness: 0.95,
    metalness: 0,
  });
  const felt = new THREE.Mesh(feltGeometry, feltMaterial);
  felt.name = "table-felt";
  felt.position.y = surfaceHeight + railRise;
  felt.receiveShadow = true;
  table.add(felt);

  // --- Apron (visible table body below the surface) ---
  const apronHeight = millimetresToMetres(140);
  const apronGeometry = buildFeltGeometry(
    halfWidth - millimetresToMetres(20),
    depth - millimetresToMetres(24),
    apronHeight,
  );
  const apronMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.railDark,
    roughness: 0.58,
    metalness: 0.2,
  });
  const apron = new THREE.Mesh(apronGeometry, apronMaterial);
  apron.name = "table-apron";
  apron.position.y = surfaceHeight - apronHeight;
  apron.castShadow = true;
  apron.receiveShadow = true;
  table.add(apron);

  table.add(buildTableLegs(theme, surfaceHeight - apronHeight));

  table.userData = {
    kind: "table-body",
    widthMm: 2400,
    depthMm: 1400,
    surfaceHeightMm: 760,
    feltHalfWidth,
    feltDepth,
  };
  return table;
}

function buildTableLegs(theme: CasinoTheme, legHeight: number): THREE.Group {
  const legs = new THREE.Group();
  legs.name = "table-legs";

  const legMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.railDark,
    roughness: 0.62,
    metalness: 0.26,
  });

  const topRadius = millimetresToMetres(54);
  const bottomRadius = millimetresToMetres(40);
  const legGeometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    legHeight,
    20,
  );

  const legOffsetX = TABLE_SIZE.width * 0.34;
  const legOffsetZ = TABLE_SIZE.depth * 0.22;

  for (const xSign of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.name = `leg-${xSign > 0 ? "R" : "L"}-${zSign > 0 ? "guest" : "dealer"}`;
      leg.position.set(xSign * legOffsetX, legHeight / 2, zSign * legOffsetZ);
      leg.castShadow = true;
      leg.receiveShadow = true;
      legs.add(leg);
    }
  }

  return legs;
}

/** Footprint of the finished table, useful for framing a camera. */
export const TABLE_FOOTPRINT = {
  width: TABLE_SIZE.width,
  depth: TABLE_SIZE.depth,
  surfaceY: TABLE_SIZE.surfaceHeight + TABLE_SIZE.railRise,
} as const;
