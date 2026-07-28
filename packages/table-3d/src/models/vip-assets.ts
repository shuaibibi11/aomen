/**
 * High-denomination plaque and membership card models.
 *
 * Plaques are the rectangular slabs used in Macau VIP rooms for values a round
 * chip cannot practically carry. Membership cards are ID-1 format, matching the
 * real loyalty cards a dealer handles at the table.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import { getCasinoMonogram } from "../specs/casino-theme.js";
import {
  MEMBER_CARD_SIZE,
  PLAQUE_SIZE,
  millimetresToMetres,
} from "../specs/dimensions.js";
import {
  getMembershipProgramme,
  getPlaqueStyle,
  type MembershipTier,
} from "../specs/vip-assets.js";
import {
  createMemberCardBackTexture,
  createMemberCardFrontTexture,
  createPlaqueFaceTexture,
} from "../textures/vip-textures.js";
import { buildFlatSlabGeometry } from "./flat-slab.js";

/** Plaques rest flat on the felt; a small gap keeps them off the surface. */
const PLAQUE_STACK_GAP = millimetresToMetres(0.12);

export interface PlaqueModelOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly denomination: number;
}

/**
 * Create one plaque lying flat, face up. Both faces carry the printed artwork
 * because a plaque is read from either side on the table.
 */
export function createPlaqueModel(options: PlaqueModelOptions): THREE.Mesh {
  const { theme, casinoId, denomination } = options;
  const style = getPlaqueStyle(denomination);

  const geometry = buildFlatSlabGeometry(
    PLAQUE_SIZE.width,
    PLAQUE_SIZE.height,
    PLAQUE_SIZE.thickness,
    PLAQUE_SIZE.cornerRadius,
    10,
  );

  const faceTexture = createPlaqueFaceTexture(
    theme,
    denomination,
    getCasinoMonogram(casinoId),
  );
  const backTexture = createPlaqueFaceTexture(
    theme,
    denomination,
    getCasinoMonogram(casinoId),
  );
  backTexture.wrapS = THREE.RepeatWrapping;
  backTexture.repeat.x = -1;

  // Acrylic reads as a low-roughness dielectric with a hint of translucency.
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    roughness: 0.22,
    metalness: 0.05,
  });
  const backMaterial = new THREE.MeshStandardMaterial({
    map: backTexture,
    roughness: 0.22,
    metalness: 0.05,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: style.body,
    roughness: 0.16,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
  });

  const plaque = new THREE.Mesh(geometry, [faceMaterial, backMaterial, edgeMaterial]);
  plaque.name = `plaque-${casinoId}-${denomination}`;
  plaque.rotation.x = -Math.PI / 2;
  plaque.castShadow = true;
  plaque.receiveShadow = true;
  plaque.userData = {
    kind: "plaque",
    casinoId,
    denomination,
    currency: theme.tableRules.currency,
  };
  return plaque;
}

export interface PlaqueStackOptions extends PlaqueModelOptions {
  readonly count: number;
}

/** Plaques are stacked flat, slightly fanned, the way they sit in a VIP tray. */
export function createPlaqueStack(options: PlaqueStackOptions): THREE.Group {
  const stack = new THREE.Group();
  stack.name = `plaque-stack-${options.casinoId}-${options.denomination}`;

  const pitch = PLAQUE_SIZE.thickness + PLAQUE_STACK_GAP;
  for (let plaqueIndex = 0; plaqueIndex < options.count; plaqueIndex += 1) {
    const plaque = createPlaqueModel(options);
    plaque.position.y = PLAQUE_SIZE.thickness / 2 + plaqueIndex * pitch;
    plaque.rotation.z = (plaqueIndex % 2 === 0 ? 1 : -1) * 0.012;
    stack.add(plaque);
  }

  stack.userData = {
    kind: "plaque-stack",
    count: options.count,
    totalValue: options.count * options.denomination,
  };
  return stack;
}

export interface MemberCardModelOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly tier: MembershipTier;
}

/** Create one membership card lying flat, face up. */
export function createMemberCardModel(
  options: MemberCardModelOptions,
): THREE.Mesh {
  const { theme, casinoId, tier } = options;
  const programme = getMembershipProgramme(casinoId);

  const geometry = buildFlatSlabGeometry(
    MEMBER_CARD_SIZE.width,
    MEMBER_CARD_SIZE.height,
    MEMBER_CARD_SIZE.thickness,
    MEMBER_CARD_SIZE.cornerRadius,
    8,
  );

  const frontTexture = createMemberCardFrontTexture(
    theme,
    programme.programmeName,
    tier,
    getCasinoMonogram(casinoId),
  );
  const backTexture = createMemberCardBackTexture(tier, theme.disclaimer);
  backTexture.wrapS = THREE.RepeatWrapping;
  backTexture.repeat.x = -1;

  // Metal-finish tiers are noticeably more specular than plastic tiers.
  const surfaceRoughness = tier.metallic ? 0.28 : 0.55;
  const surfaceMetalness = tier.metallic ? 0.65 : 0.08;

  const frontMaterial = new THREE.MeshStandardMaterial({
    map: frontTexture,
    roughness: surfaceRoughness,
    metalness: surfaceMetalness,
  });
  const backMaterial = new THREE.MeshStandardMaterial({
    map: backTexture,
    roughness: surfaceRoughness,
    metalness: surfaceMetalness,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: tier.cardColour,
    roughness: 0.5,
    metalness: surfaceMetalness,
  });

  const card = new THREE.Mesh(geometry, [frontMaterial, backMaterial, edgeMaterial]);
  card.name = `member-card-${casinoId}-${tier.name}`;
  card.rotation.x = -Math.PI / 2;
  card.castShadow = true;
  card.receiveShadow = true;
  card.userData = {
    kind: "member-card",
    casinoId,
    programme: programme.programmeName,
    tier: tier.name,
  };
  return card;
}

/**
 * Lay out one card per tier, lowest tier first, so the whole ladder can be
 * compared at a glance.
 */
export function createMemberCardSet(
  theme: CasinoTheme,
  casinoId: CasinoId,
): THREE.Group {
  const programme = getMembershipProgramme(casinoId);
  const set = new THREE.Group();
  set.name = `member-card-set-${casinoId}`;

  const spacing = MEMBER_CARD_SIZE.width * 1.14;
  programme.tiers.forEach((tier, tierIndex) => {
    const card = createMemberCardModel({ theme, casinoId, tier });
    card.position.set(
      (tierIndex - (programme.tiers.length - 1) / 2) * spacing,
      MEMBER_CARD_SIZE.thickness / 2,
      0,
    );
    set.add(card);
  });

  set.userData = {
    kind: "member-card-set",
    programme: programme.programmeName,
    tierCount: programme.tiers.length,
  };
  return set;
}
