/**
 * Table furniture: discard holder, limit sign and commission markers.
 *
 * These are the fixed props around the dealer's working area. Each is built
 * from real manufactured dimensions so a 3D table lays out correctly.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import {
  COMMISSION_MARKER_SIZE,
  DISCARD_HOLDER_SIZE,
  LIMIT_SIGN_DIMENSIONS_MM,
  LIMIT_SIGN_SIZE,
  millimetresToMetres,
} from "../specs/dimensions.js";
import { createLimitSignTexture } from "../textures/furniture-textures.js";

/**
 * Discard holder: a clear acrylic box on a solid base. Used cards are dropped
 * in face down, so a partial card block is drawn inside when it holds cards.
 */
export interface DiscardHolderOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  /** Fraction of the holder filled with used cards, 0 to 1. */
  readonly fillRatio?: number;
}

export function createDiscardHolder(
  options: DiscardHolderOptions,
): THREE.Group {
  const { theme, casinoId, fillRatio = 0.45 } = options;
  const holder = new THREE.Group();
  holder.name = `discard-holder-${casinoId}`;

  const width = DISCARD_HOLDER_SIZE.width;
  const depth = DISCARD_HOLDER_SIZE.depth;
  const height = DISCARD_HOLDER_SIZE.height;
  const wallThickness = DISCARD_HOLDER_SIZE.wallThickness;
  const baseThickness = DISCARD_HOLDER_SIZE.baseThickness;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.railDark,
    roughness: 0.62,
    metalness: 0.18,
  });
  const acrylicMaterial = new THREE.MeshStandardMaterial({
    color: "#DCE6EC",
    roughness: 0.14,
    metalness: 0.04,
    transparent: true,
    opacity: 0.32,
  });

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, baseThickness, depth),
    baseMaterial,
  );
  base.name = "discard-base";
  base.position.y = baseThickness / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  holder.add(base);

  const wallHeight = height - baseThickness;
  const wallCentreY = baseThickness + wallHeight / 2;

  const longWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, depth);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(longWallGeometry, acrylicMaterial);
    wall.name = `discard-side-${side > 0 ? "right" : "left"}`;
    wall.position.set((side * (width - wallThickness)) / 2, wallCentreY, 0);
    holder.add(wall);
  }

  const endWallGeometry = new THREE.BoxGeometry(width, wallHeight, wallThickness);
  for (const end of [-1, 1]) {
    const wall = new THREE.Mesh(endWallGeometry, acrylicMaterial);
    wall.name = `discard-end-${end > 0 ? "far" : "near"}`;
    wall.position.set(0, wallCentreY, (end * (depth - wallThickness)) / 2);
    holder.add(wall);
  }

  const clampedFill = Math.min(Math.max(fillRatio, 0), 1);
  if (clampedFill > 0) {
    const cardBlockHeight = wallHeight * clampedFill;
    const cardBlock = new THREE.Mesh(
      new THREE.BoxGeometry(
        width - wallThickness * 2.4,
        cardBlockHeight,
        depth - wallThickness * 2.4,
      ),
      new THREE.MeshStandardMaterial({
        color: theme.palette.cardBack,
        roughness: 0.74,
        metalness: 0.02,
      }),
    );
    cardBlock.name = "discard-card-block";
    cardBlock.position.y = baseThickness + cardBlockHeight / 2;
    cardBlock.castShadow = true;
    holder.add(cardBlock);
  }

  holder.userData = {
    kind: "discard-holder",
    casinoId,
    capacityDecks: 8,
    fillRatio: clampedFill,
  };
  return holder;
}

/**
 * Table limit sign: a leaning printed panel on a wedge foot, showing the
 * minimum and maximum bet for the table.
 */
export interface LimitSignOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly minimumBet: number;
  readonly maximumBet: number;
}

export function createLimitSign(options: LimitSignOptions): THREE.Group {
  const { theme, casinoId, minimumBet, maximumBet } = options;
  const sign = new THREE.Group();
  sign.name = `limit-sign-${casinoId}`;

  const panelTexture = createLimitSignTexture(theme, minimumBet, maximumBet);
  const panelGeometry = new THREE.BoxGeometry(
    LIMIT_SIGN_SIZE.width,
    LIMIT_SIGN_SIZE.height,
    LIMIT_SIGN_SIZE.thickness,
  );

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: theme.palette.railDark,
    roughness: 0.5,
    metalness: 0.35,
  });
  const faceMaterial = new THREE.MeshStandardMaterial({
    map: panelTexture,
    roughness: 0.42,
    metalness: 0.12,
  });

  // BoxGeometry material order is +X, -X, +Y, -Y, +Z, -Z; only +Z is printed.
  const panel = new THREE.Mesh(panelGeometry, [
    frameMaterial,
    frameMaterial,
    frameMaterial,
    frameMaterial,
    faceMaterial,
    frameMaterial,
  ]);
  panel.name = "limit-sign-panel";
  panel.position.y = LIMIT_SIGN_SIZE.baseHeight + LIMIT_SIGN_SIZE.height / 2;
  panel.rotation.x = (-LIMIT_SIGN_DIMENSIONS_MM.leanDegrees * Math.PI) / 180;
  panel.castShadow = true;
  panel.receiveShadow = true;
  sign.add(panel);

  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(
      LIMIT_SIGN_SIZE.width * 0.92,
      LIMIT_SIGN_SIZE.baseHeight,
      LIMIT_SIGN_SIZE.thickness * 3.4,
    ),
    frameMaterial,
  );
  foot.name = "limit-sign-foot";
  foot.position.y = LIMIT_SIGN_SIZE.baseHeight / 2;
  foot.castShadow = true;
  foot.receiveShadow = true;
  sign.add(foot);

  sign.userData = {
    kind: "limit-sign",
    casinoId,
    minimumBet,
    maximumBet,
    currency: theme.tableRules.currency,
  };
  return sign;
}

/**
 * Commission marker: a small numbered disc placed in the commission box to
 * record what a seat owes when the table runs standard 5% commission.
 */
export function createCommissionMarker(
  theme: CasinoTheme,
  seatNumber: number,
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    COMMISSION_MARKER_SIZE.radius,
    COMMISSION_MARKER_SIZE.radius,
    COMMISSION_MARKER_SIZE.thickness,
    32,
  );
  const material = new THREE.MeshStandardMaterial({
    color: theme.palette.gold,
    roughness: 0.38,
    metalness: 0.72,
  });
  const marker = new THREE.Mesh(geometry, material);
  marker.name = `commission-marker-seat-${seatNumber}`;
  marker.position.y = COMMISSION_MARKER_SIZE.thickness / 2;
  marker.castShadow = true;
  marker.receiveShadow = true;
  marker.userData = { kind: "commission-marker", seatNumber };
  return marker;
}

/** A row of commission markers, one per seat. */
export function createCommissionMarkerSet(
  theme: CasinoTheme,
  seatCount: number,
): THREE.Group {
  const set = new THREE.Group();
  set.name = "commission-marker-set";

  const spacing = COMMISSION_MARKER_SIZE.radius * 2 + millimetresToMetres(8);
  for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
    const marker = createCommissionMarker(theme, seatIndex + 1);
    marker.position.x = (seatIndex - (seatCount - 1) / 2) * spacing;
    set.add(marker);
  }

  set.userData = { kind: "commission-marker-set", seatCount };
  return set;
}
