/**
 * Dealing shoe and cut card.
 *
 * The shoe body is a tapered wedge: tall at the rear where the card stack sits,
 * sloping down to a short front lip where the dealer slides cards out one at a
 * time. The acrylic walls are translucent so the card backs are visible from
 * the player side, which is intentional on a live table.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import {
  CUT_CARD_SIZE,
  DEALING_SHOE_SIZE,
  millimetresToMetres,
} from "../specs/dimensions.js";

const ACRYLIC_ROUGHNESS = 0.18;
const ACRYLIC_METALNESS = 0.06;
const ACRYLIC_OPACITY = 0.75;

export interface DealingShoeOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
}

function buildShoeAcrylicMaterial(
  color: string,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: ACRYLIC_ROUGHNESS,
    metalness: ACRYLIC_METALNESS,
    transparent: true,
    opacity: ACRYLIC_OPACITY,
  });
}

/**
 * Build the tapered acrylic body using six face quads so each wall can be a
 * separate mesh with correct normals. This avoids the UV seams that arise from
 * extruding a tapered shape.
 */
function buildShoeBody(theme: CasinoTheme): THREE.Group {
  const shoe = new THREE.Group();
  shoe.name = "dealing-shoe-body";

  const wallMaterial = buildShoeAcrylicMaterial(theme.palette.rail);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.railDark,
    roughness: 0.6,
    metalness: 0.3,
  });

  const length = DEALING_SHOE_SIZE.length;
  const width = DEALING_SHOE_SIZE.width;
  const wallThickness = DEALING_SHOE_SIZE.wallThickness;
  const rearHeight = DEALING_SHOE_SIZE.rearHeight;
  const frontHeight = DEALING_SHOE_SIZE.frontHeight;
  const baseThickness = DEALING_SHOE_SIZE.baseThickness;

  // Base slab
  const baseGeometry = new THREE.BoxGeometry(width, baseThickness, length);
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.name = "shoe-base";
  base.position.y = baseThickness / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  shoe.add(base);

  // Rear wall (tall end where cards are loaded)
  const rearGeometry = new THREE.BoxGeometry(width, rearHeight, wallThickness);
  const rearWall = new THREE.Mesh(rearGeometry, wallMaterial);
  rearWall.name = "shoe-rear-wall";
  rearWall.position.set(0, baseThickness + rearHeight / 2, -length / 2 + wallThickness / 2);
  rearWall.castShadow = true;
  shoe.add(rearWall);

  // Front lip (low edge the dealer pushes cards under)
  const lipGeometry = new THREE.BoxGeometry(width, frontHeight, wallThickness);
  const frontLip = new THREE.Mesh(lipGeometry, wallMaterial);
  frontLip.name = "shoe-front-lip";
  frontLip.position.set(0, baseThickness + frontHeight / 2, length / 2 - wallThickness / 2);
  frontLip.castShadow = true;
  shoe.add(frontLip);

  // Left side wall with slope
  const buildSideWall = (xSign: number): THREE.Mesh => {
    const geometry = new THREE.BufferGeometry();
    const halfW = wallThickness / 2;
    const halfLen = length / 2;
    const frontZ = halfLen - wallThickness;
    const rearZ = -halfLen + wallThickness;
    const topBase = baseThickness;

    const positions = new Float32Array([
      // front-bottom, rear-bottom, rear-top-rear, front-top-front (two triangles)
      halfW, topBase, frontZ,
      halfW, topBase, rearZ,
      halfW, topBase + rearHeight, rearZ,

      halfW, topBase, frontZ,
      halfW, topBase + rearHeight, rearZ,
      halfW, topBase + frontHeight, frontZ,
    ]);

    // Mirror for opposite side
    if (xSign < 0) {
      for (let index = 0; index < positions.length; index += 3) {
        (positions as Float32Array)[index] = -(positions[index] as number);
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, wallMaterial);
    mesh.name = `shoe-side-wall-${xSign > 0 ? "right" : "left"}`;
    mesh.position.x = (xSign * (width / 2 - wallThickness / 2));
    mesh.castShadow = true;
    return mesh;
  };

  shoe.add(buildSideWall(1));
  shoe.add(buildSideWall(-1));

  // Metal roller bar at the rear, helps push the card stack forward
  const rollerGeometry = new THREE.CylinderGeometry(
    millimetresToMetres(7),
    millimetresToMetres(7),
    width * 0.7,
    16,
  );
  const rollerMaterial = new THREE.MeshStandardMaterial({
    color: "#888888",
    roughness: 0.4,
    metalness: 0.8,
  });
  const roller = new THREE.Mesh(rollerGeometry, rollerMaterial);
  roller.name = "shoe-roller";
  roller.rotation.z = Math.PI / 2;
  roller.position.set(
    0,
    baseThickness + rearHeight * 0.45,
    -length / 2 + wallThickness + millimetresToMetres(20),
  );
  shoe.add(roller);

  return shoe;
}

/**
 * Create a stack of card backs visible through the transparent rear wall —
 * confirms the shoe has been loaded and the backs are the correct casino theme.
 */
function buildCardStackInShoe(theme: CasinoTheme): THREE.Group {
  const group = new THREE.Group();
  group.name = "shoe-card-stack";

  const stackMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.cardBack,
    roughness: 0.7,
    metalness: 0.02,
  });

  const stackWidth = DEALING_SHOE_SIZE.width * 0.72;
  const stackHeight = millimetresToMetres(170);
  const stackLength = DEALING_SHOE_SIZE.length * 0.72;

  const geometry = new THREE.BoxGeometry(stackWidth, stackHeight, stackLength);
  const stack = new THREE.Mesh(geometry, stackMaterial);
  stack.name = "card-stack-block";
  stack.position.set(
    0,
    DEALING_SHOE_SIZE.baseThickness + stackHeight / 2,
    -DEALING_SHOE_SIZE.length * 0.08,
  );
  group.add(stack);

  return group;
}

export function createDealingShoe(options: DealingShoeOptions): THREE.Group {
  const { theme } = options;
  const shoe = new THREE.Group();
  shoe.name = `dealing-shoe-${options.casinoId}`;
  shoe.add(buildShoeBody(theme));
  shoe.add(buildCardStackInShoe(theme));

  shoe.userData = {
    kind: "dealing-shoe",
    casinoId: options.casinoId,
    deckCount: 8,
    dimensions: {
      lengthMm: 420,
      widthMm: 105,
      heightMm: 145,
    },
  };
  return shoe;
}

/** Create the coloured cut card that is inserted into the shoe. */
export function createCutCard(theme: CasinoTheme): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(
    CUT_CARD_SIZE.width,
    CUT_CARD_SIZE.height,
    CUT_CARD_SIZE.thickness,
  );
  const material = new THREE.MeshStandardMaterial({
    color: theme.palette.accent,
    roughness: 0.55,
    metalness: 0.02,
  });
  const card = new THREE.Mesh(geometry, material);
  card.name = "cut-card";
  card.rotation.x = -Math.PI / 2;
  card.userData = { kind: "cut-card" };
  return card;
}
