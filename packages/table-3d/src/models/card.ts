/**
 * Procedural playing-card model.
 *
 * A card is a rounded rectangle extruded to real stock thickness. The extrusion
 * produces three material groups (front, back, edge) so the face art, the back
 * engraving and the white cut edge are all correct without a custom shader.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import { getCasinoMonogram } from "../specs/casino-theme.js";
import { CARD_SIZE, CARD_STACK_GAP } from "../specs/dimensions.js";
import {
  createCardBackTexture,
  createCardFaceTexture,
  type CardRank,
  type CardSuit,
} from "../textures/card-textures.js";

const CORNER_CURVE_SEGMENTS = 6;

/**
 * Build the card outline centred on the origin, with the four corners rounded
 * to the real corner radius.
 */
function buildCardOutline(): THREE.Shape {
  const halfWidth = CARD_SIZE.width / 2;
  const halfHeight = CARD_SIZE.height / 2;
  const radius = CARD_SIZE.cornerRadius;

  const outline = new THREE.Shape();
  outline.moveTo(-halfWidth + radius, -halfHeight);
  outline.lineTo(halfWidth - radius, -halfHeight);
  outline.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  outline.lineTo(halfWidth, halfHeight - radius);
  outline.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  outline.lineTo(-halfWidth + radius, halfHeight);
  outline.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  outline.lineTo(-halfWidth, -halfHeight + radius);
  outline.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
  return outline;
}

/**
 * Extrusion UVs default to world-space, which stretches the artwork. This
 * remaps the front and back caps to the 0..1 range of the card outline.
 */
function remapCapUvs(geometry: THREE.ExtrudeGeometry): void {
  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  const halfWidth = CARD_SIZE.width / 2;
  const halfHeight = CARD_SIZE.height / 2;

  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const x = positionAttribute.getX(vertexIndex);
    const y = positionAttribute.getY(vertexIndex);
    uvAttribute.setXY(
      vertexIndex,
      (x + halfWidth) / CARD_SIZE.width,
      (y + halfHeight) / CARD_SIZE.height,
    );
  }
  uvAttribute.needsUpdate = true;
}

export interface CardModelOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly rank: CardRank;
  readonly suit: CardSuit;
}

/**
 * Create one card lying face-up in the XZ plane, so a dealt hand can be placed
 * directly onto a table surface.
 */
export function createCardModel(options: CardModelOptions): THREE.Mesh {
  const { theme, casinoId, rank, suit } = options;

  const geometry = new THREE.ExtrudeGeometry(buildCardOutline(), {
    depth: CARD_SIZE.thickness,
    bevelEnabled: false,
    curveSegments: CORNER_CURVE_SEGMENTS,
  });
  geometry.center();
  remapCapUvs(geometry);

  const faceTexture = createCardFaceTexture(theme, rank, suit);
  const backTexture = createCardBackTexture(theme, getCasinoMonogram(casinoId));
  backTexture.wrapS = THREE.RepeatWrapping;
  backTexture.repeat.x = -1;

  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    roughness: 0.72,
    metalness: 0,
  });
  const backMaterial = new THREE.MeshStandardMaterial({
    map: backTexture,
    roughness: 0.72,
    metalness: 0,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: "#F7F4EA",
    roughness: 0.85,
    metalness: 0,
  });

  // ExtrudeGeometry emits group 0 for the caps and group 1 for the wall. The
  // caps are split so the front and back can carry different artwork.
  geometry.clearGroups();
  const indexCount = geometry.index?.count ?? 0;
  const capTriangleCount = countCapIndices(geometry);
  const halfCap = capTriangleCount / 2;
  geometry.addGroup(0, halfCap, 0);
  geometry.addGroup(halfCap, halfCap, 1);
  geometry.addGroup(capTriangleCount, indexCount - capTriangleCount, 2);

  const card = new THREE.Mesh(geometry, [faceMaterial, backMaterial, edgeMaterial]);
  card.name = `card-${casinoId}-${rank}${suit}`;
  card.castShadow = true;
  card.receiveShadow = true;

  // Lay the card flat: the outline is built in XY, so tip it into XZ.
  card.rotation.x = -Math.PI / 2;

  card.userData = { kind: "card", casinoId, rank, suit };
  return card;
}

/**
 * ExtrudeGeometry writes both caps before the side wall. Cap triangles are the
 * ones whose vertices share a single Z value, so counting them gives the split
 * point between the caps and the wall.
 */
function countCapIndices(geometry: THREE.ExtrudeGeometry): number {
  const index = geometry.index;
  const positionAttribute = geometry.getAttribute("position");
  if (index === null) {
    return 0;
  }

  let capIndexCount = 0;
  for (let triangleStart = 0; triangleStart < index.count; triangleStart += 3) {
    const firstZ = positionAttribute.getZ(index.getX(triangleStart));
    const secondZ = positionAttribute.getZ(index.getX(triangleStart + 1));
    const thirdZ = positionAttribute.getZ(index.getX(triangleStart + 2));
    const isFlatTriangle =
      Math.abs(firstZ - secondZ) < 1e-9 && Math.abs(secondZ - thirdZ) < 1e-9;
    if (!isFlatTriangle) {
      break;
    }
    capIndexCount += 3;
  }
  return capIndexCount;
}

export interface CardHandOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly cards: ReadonlyArray<{ rank: CardRank; suit: CardSuit }>;
  /** Horizontal offset between cards, in metres. */
  readonly spread?: number;
  readonly faceDown?: boolean;
}

/**
 * Lay out a dealt hand: cards side by side with a slight stagger, the way a
 * baccarat hand sits in front of the shoe.
 */
export function createCardHand(options: CardHandOptions): THREE.Group {
  const { theme, casinoId, cards, spread = CARD_SIZE.width * 0.62, faceDown = false } = options;
  const hand = new THREE.Group();
  hand.name = `card-hand-${casinoId}`;

  cards.forEach((cardSpec, cardIndex) => {
    const card = createCardModel({
      theme,
      casinoId,
      rank: cardSpec.rank,
      suit: cardSpec.suit,
    });
    card.position.x = (cardIndex - (cards.length - 1) / 2) * spread;
    card.position.y = CARD_SIZE.thickness / 2 + cardIndex * CARD_STACK_GAP;
    card.position.z = cardIndex % 2 === 0 ? 0 : CARD_SIZE.height * 0.04;
    if (faceDown) {
      card.rotation.z = Math.PI;
      card.rotation.x = Math.PI / 2;
    }
    hand.add(card);
  });

  hand.userData = { kind: "card-hand", cardCount: cards.length };
  return hand;
}
