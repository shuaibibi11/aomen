/**
 * Shared geometry helpers for flat, rounded-corner props (cards, plaques,
 * membership cards).
 *
 * Extruded shapes need two fixes before they can carry front/back artwork:
 * UVs must be remapped out of world space, and the cap triangles must be split
 * into separate material groups.
 */
import * as THREE from "three";

/** Build a centred rounded rectangle in the XY plane. */
export function buildRoundedRectShape(
  width: number,
  height: number,
  cornerRadius: number,
): THREE.Shape {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(cornerRadius, halfWidth, halfHeight);

  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
  return shape;
}

/** Remap extrusion UVs from world space into the 0..1 range of the outline. */
export function remapExtrudeCapUvs(
  geometry: THREE.ExtrudeGeometry,
  width: number,
  height: number,
): void {
  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    uvAttribute.setXY(
      vertexIndex,
      (positionAttribute.getX(vertexIndex) + halfWidth) / width,
      (positionAttribute.getY(vertexIndex) + halfHeight) / height,
    );
  }
  uvAttribute.needsUpdate = true;
}

/** Material slot for each face of the slab. */
const FRONT_MATERIAL_SLOT = 0;
const BACK_MATERIAL_SLOT = 1;
const EDGE_MATERIAL_SLOT = 2;

/**
 * Classify one triangle by the Z values of its three vertices: a triangle
 * sitting entirely at the front or back extreme is a cap, anything else is
 * part of the side wall.
 */
function classifyTriangle(
  positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  firstVertexIndex: number,
  frontZ: number,
  backZ: number,
): number {
  const tolerance = 1e-6;
  let atFrontCount = 0;
  let atBackCount = 0;

  for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
    const vertexZ = positionAttribute.getZ(firstVertexIndex + vertexOffset);
    if (Math.abs(vertexZ - frontZ) < tolerance) {
      atFrontCount += 1;
    } else if (Math.abs(vertexZ - backZ) < tolerance) {
      atBackCount += 1;
    }
  }

  if (atFrontCount === 3) {
    return FRONT_MATERIAL_SLOT;
  }
  if (atBackCount === 3) {
    return BACK_MATERIAL_SLOT;
  }
  return EDGE_MATERIAL_SLOT;
}

/**
 * Split the geometry into three material groups: front cap, back cap and the
 * side wall, so each can carry its own material.
 *
 * ExtrudeGeometry produces non-indexed geometry, so groups are expressed as
 * ranges over the position attribute rather than over an index buffer. Runs of
 * consecutive triangles with the same classification are merged into one group
 * to keep the draw-call count low.
 */
export function assignFrontBackEdgeGroups(geometry: THREE.ExtrudeGeometry): void {
  const positionAttribute = geometry.getAttribute("position");
  const vertexCount = positionAttribute.count;
  if (vertexCount === 0) {
    return;
  }

  let frontZ = Number.NEGATIVE_INFINITY;
  let backZ = Number.POSITIVE_INFINITY;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const vertexZ = positionAttribute.getZ(vertexIndex);
    frontZ = Math.max(frontZ, vertexZ);
    backZ = Math.min(backZ, vertexZ);
  }

  geometry.clearGroups();

  let runStartVertex = 0;
  let runMaterialSlot = classifyTriangle(positionAttribute, 0, frontZ, backZ);

  for (let vertexIndex = 3; vertexIndex < vertexCount; vertexIndex += 3) {
    const materialSlot = classifyTriangle(
      positionAttribute,
      vertexIndex,
      frontZ,
      backZ,
    );
    if (materialSlot !== runMaterialSlot) {
      geometry.addGroup(runStartVertex, vertexIndex - runStartVertex, runMaterialSlot);
      runStartVertex = vertexIndex;
      runMaterialSlot = materialSlot;
    }
  }
  geometry.addGroup(runStartVertex, vertexCount - runStartVertex, runMaterialSlot);
}

/**
 * Build a flat slab ready for front/back/edge materials, lying in the XZ plane
 * so it can be dropped straight onto a table surface.
 */
export function buildFlatSlabGeometry(
  width: number,
  height: number,
  thickness: number,
  cornerRadius: number,
  curveSegments = 8,
): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(
    buildRoundedRectShape(width, height, cornerRadius),
    { depth: thickness, bevelEnabled: false, curveSegments },
  );
  geometry.center();
  remapExtrudeCapUvs(geometry, width, height);
  assignFrontBackEdgeGroups(geometry);
  return geometry;
}
