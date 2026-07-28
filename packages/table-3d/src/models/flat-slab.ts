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

/**
 * ExtrudeGeometry writes both flat caps before the side wall. Counting the
 * leading run of triangles whose vertices share one Z value gives the split
 * point between caps and wall.
 */
function countCapIndices(geometry: THREE.ExtrudeGeometry): number {
  const index = geometry.index;
  if (index === null) {
    return 0;
  }
  const positionAttribute = geometry.getAttribute("position");

  let capIndexCount = 0;
  for (let triangleStart = 0; triangleStart < index.count; triangleStart += 3) {
    const firstZ = positionAttribute.getZ(index.getX(triangleStart));
    const secondZ = positionAttribute.getZ(index.getX(triangleStart + 1));
    const thirdZ = positionAttribute.getZ(index.getX(triangleStart + 2));
    const isFlat =
      Math.abs(firstZ - secondZ) < 1e-9 && Math.abs(secondZ - thirdZ) < 1e-9;
    if (!isFlat) {
      break;
    }
    capIndexCount += 3;
  }
  return capIndexCount;
}

/**
 * Split the geometry into three material groups: front cap, back cap and the
 * side wall, so each can carry its own material.
 */
export function assignFrontBackEdgeGroups(geometry: THREE.ExtrudeGeometry): void {
  const totalIndexCount = geometry.index?.count ?? 0;
  const capIndexCount = countCapIndices(geometry);
  const halfCapIndexCount = capIndexCount / 2;

  geometry.clearGroups();
  geometry.addGroup(0, halfCapIndexCount, 0);
  geometry.addGroup(halfCapIndexCount, halfCapIndexCount, 1);
  geometry.addGroup(capIndexCount, totalIndexCount - capIndexCount, 2);
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
