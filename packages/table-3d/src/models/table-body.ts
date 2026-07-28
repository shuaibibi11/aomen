/**
 * Kidney-shaped baccarat table body: felt surface, padded rail, apron and legs.
 *
 * The outline is a closed curve, flat along the dealer edge and bowed outwards
 * along the guest edge. Felt and rail are built from the same outline at two
 * scales so the rail always follows the felt exactly.
 */
import * as THREE from "three";
import type { CasinoTheme } from "../specs/casino-theme.js";
import { millimetresToMetres } from "../specs/dimensions.js";
import { TABLE_SIZE } from "../specs/table-layout.js";

const OUTLINE_SEGMENTS = 96;

/**
 * Build the table outline in the XZ plane, returned as 2D points in XY for
 * shape extrusion. The dealer edge is flat at negative Y; the guest edge bows
 * out to positive Y, waisted slightly at the ends so it reads as a kidney
 * rather than a plain half-ellipse.
 */
function buildTableOutlinePoints(
  halfWidth: number,
  depth: number,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const dealerEdgeY = -depth * 0.34;

  // Guest arc, swept from the right end round to the left end.
  for (let step = 0; step <= OUTLINE_SEGMENTS; step += 1) {
    const progress = step / OUTLINE_SEGMENTS;
    const angle = progress * Math.PI;
    const x = halfWidth * Math.cos(angle);

    // Waist factor pulls the curve in near the ends, giving the kidney profile.
    const waist = 1 - 0.18 * Math.cos(angle) ** 2;
    const y = dealerEdgeY + depth * Math.sin(angle) * waist;
    points.push(new THREE.Vector2(x, y));
  }

  // Flat dealer edge, closing the outline back to the start.
  points.push(new THREE.Vector2(-halfWidth, dealerEdgeY));
  points.push(new THREE.Vector2(halfWidth, dealerEdgeY));

  return points;
}

function buildOutlineShape(halfWidth: number, depth: number): THREE.Shape {
  return new THREE.Shape(buildTableOutlinePoints(halfWidth, depth));
}

/**
 * Extrude an outline into a slab lying in the XZ plane, with UVs remapped so a
 * printed layout texture covers the whole footprint.
 */
function buildSlabFromOutline(
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

  // Lay the slab flat: the outline is authored in XY.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export interface TableBodyOptions {
  readonly theme: CasinoTheme;
  /** Printed layout applied to the felt surface. */
  readonly layoutTexture: THREE.Texture;
}

/**
 * Build the complete table body. The felt sits on top of a rail ring, which
 * sits on an apron and four legs.
 */
export function createTableBody(options: TableBodyOptions): THREE.Group {
  const { theme, layoutTexture } = options;
  const table = new THREE.Group();
  table.name = "table-body";

  const halfWidth = TABLE_SIZE.width / 2;
  const depth = TABLE_SIZE.depth;
  const surfaceHeight = TABLE_SIZE.surfaceHeight;
  const railWidth = TABLE_SIZE.railWidth;

  // Rail ring: the same outline at full size, standing proud of the felt.
  const railGeometry = buildSlabFromOutline(
    halfWidth,
    depth,
    TABLE_SIZE.railRise + millimetresToMetres(6),
  );
  const railMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.rail,
    roughness: 0.42,
    metalness: 0.24,
  });
  const rail = new THREE.Mesh(railGeometry, railMaterial);
  rail.name = "table-rail";
  rail.position.y = surfaceHeight;
  rail.castShadow = true;
  rail.receiveShadow = true;
  table.add(rail);

  // Felt surface: the outline inset by the rail width, sitting on top.
  const feltHalfWidth = halfWidth - railWidth;
  const feltDepth = depth - railWidth * 1.15;
  const feltGeometry = buildSlabFromOutline(
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
  felt.position.y = surfaceHeight + TABLE_SIZE.railRise;
  felt.receiveShadow = true;
  table.add(felt);

  // Apron: a shallower copy of the outline forming the visible table body.
  const apronHeight = millimetresToMetres(140);
  const apronGeometry = buildSlabFromOutline(
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
  };
  return table;
}

/** Four tapered legs, inset from the table edge. */
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
      leg.name = `table-leg-${xSign > 0 ? "right" : "left"}-${zSign > 0 ? "guest" : "dealer"}`;
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
