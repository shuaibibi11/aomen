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
import { buildFlatSlabGeometry } from "./flat-slab.js";

const CORNER_CURVE_SEGMENTS = 6;

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

  const geometry = buildFlatSlabGeometry(
    CARD_SIZE.width,
    CARD_SIZE.height,
    CARD_SIZE.thickness,
    CARD_SIZE.cornerRadius,
    CORNER_CURVE_SEGMENTS,
  );

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

  const card = new THREE.Mesh(geometry, [faceMaterial, backMaterial, edgeMaterial]);
  card.name = `card-${casinoId}-${rank}${suit}`;
  card.castShadow = true;
  card.receiveShadow = true;

  // Lay the card flat: the outline is built in XY, so tip it into XZ.
  card.rotation.x = -Math.PI / 2;

  card.userData = { kind: "card", casinoId, rank, suit };
  return card;
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
