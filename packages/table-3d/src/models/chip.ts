/**
 * Procedural chip model.
 *
 * A chip is a lathe-turned disc: the rim profile is described as a 2D outline
 * and revolved, so the mould differences between casinos (square edge, wide
 * chamfer, bevel, teeth) come out of the profile rather than out of textures.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import { getCasinoMonogram } from "../specs/casino-theme.js";
import { CHIP_SIZE, CHIP_STACK_GAP } from "../specs/dimensions.js";
import { getMouldProfile } from "../specs/denominations.js";
import {
  createChipFaceTexture,
  createChipRimTexture,
} from "../textures/chip-textures.js";

const RIM_RADIAL_SEGMENTS = 96;

export interface ChipModelOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly denomination: number;
}

/**
 * Build the rim silhouette from the outer radius inwards. Points run from the
 * bottom face edge, up the chamfered rim, to the top face edge.
 */
function buildRimProfile(chamferScale: number): THREE.Vector2[] {
  const halfThickness = CHIP_SIZE.thickness / 2;
  const chamfer = CHIP_SIZE.rimChamfer * chamferScale;
  const outerRadius = CHIP_SIZE.radius;
  const chamferedRadius = outerRadius - chamfer;

  return [
    new THREE.Vector2(chamferedRadius, -halfThickness),
    new THREE.Vector2(outerRadius, -halfThickness + chamfer),
    new THREE.Vector2(outerRadius, halfThickness - chamfer),
    new THREE.Vector2(chamferedRadius, halfThickness),
  ];
}

/**
 * Create one chip as a group of three meshes: the revolved rim plus a top and
 * bottom face disc carrying the printed inlay.
 */
export function createChipModel(options: ChipModelOptions): THREE.Group {
  const { theme, casinoId, denomination } = options;
  const mouldProfile = getMouldProfile(theme.materials.chipMould);
  const monogram = getCasinoMonogram(casinoId);

  const chip = new THREE.Group();
  chip.name = `chip-${casinoId}-${denomination}`;

  const rimTexture = createChipRimTexture(theme, denomination);
  const rimGeometry = new THREE.LatheGeometry(
    buildRimProfile(mouldProfile.chamferScale),
    RIM_RADIAL_SEGMENTS,
  );
  const rimMaterial = new THREE.MeshStandardMaterial({
    map: rimTexture,
    roughness: 0.62,
    metalness: 0.04,
  });
  const rimMesh = new THREE.Mesh(rimGeometry, rimMaterial);
  rimMesh.name = "chip-rim";
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  chip.add(rimMesh);

  const faceTexture = createChipFaceTexture(theme, denomination, monogram);
  const faceRadius = CHIP_SIZE.radius - CHIP_SIZE.rimChamfer * mouldProfile.chamferScale;
  const faceGeometry = new THREE.CircleGeometry(faceRadius, RIM_RADIAL_SEGMENTS);
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    roughness: 0.5,
    metalness: 0.06,
  });

  const topFace = new THREE.Mesh(faceGeometry, faceMaterial);
  topFace.name = "chip-face-top";
  topFace.rotation.x = -Math.PI / 2;
  topFace.position.y = CHIP_SIZE.thickness / 2;
  topFace.castShadow = false;
  topFace.receiveShadow = true;
  chip.add(topFace);

  const bottomFace = new THREE.Mesh(faceGeometry, faceMaterial);
  bottomFace.name = "chip-face-bottom";
  bottomFace.rotation.x = Math.PI / 2;
  bottomFace.position.y = -CHIP_SIZE.thickness / 2;
  chip.add(bottomFace);

  chip.userData = {
    kind: "chip",
    casinoId,
    denomination,
    currency: theme.tableRules.currency,
    chipMould: theme.materials.chipMould,
    insertCount: theme.materials.chipInserts,
  };

  return chip;
}

export interface ChipStackOptions extends ChipModelOptions {
  readonly count: number;
  /** Small random lean so a stack does not look machine-perfect. */
  readonly jitter?: boolean;
}

/**
 * Stack chips the way a dealer does, with a hair of air between discs and a
 * slight rotational offset per chip.
 */
export function createChipStack(options: ChipStackOptions): THREE.Group {
  const { count, jitter = true } = options;
  const stack = new THREE.Group();
  stack.name = `chip-stack-${options.casinoId}-${options.denomination}`;

  const chipPitch = CHIP_SIZE.thickness + CHIP_STACK_GAP;

  for (let chipIndex = 0; chipIndex < count; chipIndex += 1) {
    const chip = createChipModel(options);
    chip.position.y = CHIP_SIZE.thickness / 2 + chipIndex * chipPitch;
    chip.rotation.y = jitter
      ? (chipIndex * 137.5 * Math.PI) / 180
      : 0;
    if (jitter) {
      const lean = 0.0009;
      chip.position.x = Math.sin(chipIndex * 1.7) * lean;
      chip.position.z = Math.cos(chipIndex * 2.3) * lean;
    }
    stack.add(chip);
  }

  stack.userData = {
    kind: "chip-stack",
    count,
    denomination: options.denomination,
    totalValue: count * options.denomination,
    heightMetres: count * chipPitch,
  };

  return stack;
}
