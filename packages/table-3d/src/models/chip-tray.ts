/**
 * Dealer chip tray (碼盤).
 *
 * The tray sits in front of the dealer and holds the table float. Its geometry
 * is driven by the chip it carries: five channels, each holding twenty chips,
 * at the standard 68 mm row pitch. Channels are built as gaps between raised
 * dividers rather than boolean-subtracted pockets, which keeps the mesh cheap
 * and the walls single-sided.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import {
  CHIP_SIZE,
  CHIP_TRAY_SIZE,
  CHIP_TRAY_SPEC,
  CHIP_STACK_GAP,
  millimetresToMetres,
} from "../specs/dimensions.js";
import { createChipModel } from "./chip.js";

/** Chips lie on their side in the channel, so a row is as long as N thicknesses. */
const CHIP_ROW_LENGTH =
  CHIP_TRAY_SPEC.chipsPerRow * (CHIP_SIZE.thickness + CHIP_STACK_GAP);

const TRAY_INNER_LENGTH = CHIP_ROW_LENGTH + CHIP_TRAY_SIZE.endMargin * 2;
const TRAY_WIDTH =
  CHIP_TRAY_SPEC.rowCount * CHIP_TRAY_SIZE.rowPitch + CHIP_TRAY_SIZE.wallThickness * 2;
const TRAY_OUTER_LENGTH = TRAY_INNER_LENGTH + CHIP_TRAY_SIZE.wallThickness * 2;
const TRAY_BASE_THICKNESS = millimetresToMetres(8);
const TRAY_WALL_HEIGHT = CHIP_TRAY_SIZE.channelDepth;

/** Divider walls are thinner than the outer shell. */
const DIVIDER_THICKNESS = millimetresToMetres(3.5);

export interface ChipTrayOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  /**
   * Denomination loaded into each channel, lowest value nearest the dealer's
   * right, matching how a float is racked. Pass fewer than five to leave
   * channels empty.
   */
  readonly loadedDenominations?: readonly number[];
  /** Chips per loaded channel; defaults to a full row. */
  readonly chipsPerChannel?: number;
}

function createTrayShellMaterial(theme: CasinoTheme): THREE.MeshStandardMaterial {
  // Trays are typically dark hardwood or matte polymer with a metal lip.
  return new THREE.MeshStandardMaterial({
    color: theme.palette.railDark,
    roughness: 0.55,
    metalness: 0.12,
  });
}

function createTrayLipMaterial(theme: CasinoTheme): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: theme.palette.gold,
    roughness: 0.32,
    metalness: 0.78,
  });
}

/**
 * Build the tray shell: base, two long side walls, two end walls, four interior
 * dividers and a metal lip along the top of each long side.
 */
function buildTrayShell(theme: CasinoTheme): THREE.Group {
  const shell = new THREE.Group();
  shell.name = "chip-tray-shell";

  const shellMaterial = createTrayShellMaterial(theme);
  const lipMaterial = createTrayLipMaterial(theme);

  const baseGeometry = new THREE.BoxGeometry(
    TRAY_WIDTH,
    TRAY_BASE_THICKNESS,
    TRAY_OUTER_LENGTH,
  );
  const base = new THREE.Mesh(baseGeometry, shellMaterial);
  base.name = "tray-base";
  base.position.y = TRAY_BASE_THICKNESS / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  shell.add(base);

  const wallCentreY = TRAY_BASE_THICKNESS + TRAY_WALL_HEIGHT / 2;

  const longWallGeometry = new THREE.BoxGeometry(
    CHIP_TRAY_SIZE.wallThickness,
    TRAY_WALL_HEIGHT,
    TRAY_OUTER_LENGTH,
  );
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(longWallGeometry, shellMaterial);
    wall.name = `tray-side-wall-${side > 0 ? "right" : "left"}`;
    wall.position.set(
      (side * (TRAY_WIDTH - CHIP_TRAY_SIZE.wallThickness)) / 2,
      wallCentreY,
      0,
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    shell.add(wall);

    const lipGeometry = new THREE.BoxGeometry(
      CHIP_TRAY_SIZE.wallThickness * 1.25,
      millimetresToMetres(2.5),
      TRAY_OUTER_LENGTH,
    );
    const lip = new THREE.Mesh(lipGeometry, lipMaterial);
    lip.name = `tray-lip-${side > 0 ? "right" : "left"}`;
    lip.position.set(
      (side * (TRAY_WIDTH - CHIP_TRAY_SIZE.wallThickness)) / 2,
      TRAY_BASE_THICKNESS + TRAY_WALL_HEIGHT,
      0,
    );
    shell.add(lip);
  }

  const endWallGeometry = new THREE.BoxGeometry(
    TRAY_WIDTH,
    TRAY_WALL_HEIGHT,
    CHIP_TRAY_SIZE.wallThickness,
  );
  for (const end of [-1, 1]) {
    const endWall = new THREE.Mesh(endWallGeometry, shellMaterial);
    endWall.name = `tray-end-wall-${end > 0 ? "far" : "near"}`;
    endWall.position.set(
      0,
      wallCentreY,
      (end * (TRAY_OUTER_LENGTH - CHIP_TRAY_SIZE.wallThickness)) / 2,
    );
    endWall.castShadow = true;
    endWall.receiveShadow = true;
    shell.add(endWall);
  }

  // Dividers sit between adjacent channels: one fewer than the channel count.
  const dividerGeometry = new THREE.BoxGeometry(
    DIVIDER_THICKNESS,
    TRAY_WALL_HEIGHT * 0.92,
    TRAY_INNER_LENGTH,
  );
  for (
    let dividerIndex = 1;
    dividerIndex < CHIP_TRAY_SPEC.rowCount;
    dividerIndex += 1
  ) {
    const divider = new THREE.Mesh(dividerGeometry, shellMaterial);
    divider.name = `tray-divider-${dividerIndex}`;
    divider.position.set(
      channelCentreX(dividerIndex) - CHIP_TRAY_SIZE.rowPitch / 2,
      TRAY_BASE_THICKNESS + (TRAY_WALL_HEIGHT * 0.92) / 2,
      0,
    );
    divider.castShadow = true;
    divider.receiveShadow = true;
    shell.add(divider);
  }

  return shell;
}

/** Lateral centre of one channel, indexed from the left. */
function channelCentreX(channelIndex: number): number {
  const firstChannelCentre =
    -TRAY_WIDTH / 2 +
    CHIP_TRAY_SIZE.wallThickness +
    CHIP_TRAY_SIZE.rowPitch / 2;
  return firstChannelCentre + channelIndex * CHIP_TRAY_SIZE.rowPitch;
}

/**
 * Fill one channel with chips lying on their sides, the way a racked float
 * looks from the dealer's seat.
 */
function buildLoadedChannel(
  theme: CasinoTheme,
  casinoId: CasinoId,
  denomination: number,
  chipCount: number,
): THREE.Group {
  const channel = new THREE.Group();
  channel.name = `tray-channel-${denomination}`;

  const chipPitch = CHIP_SIZE.thickness + CHIP_STACK_GAP;
  const runLength = chipCount * chipPitch;
  const startZ = -runLength / 2 + chipPitch / 2;

  for (let chipIndex = 0; chipIndex < chipCount; chipIndex += 1) {
    const chip = createChipModel({ theme, casinoId, denomination });
    // Tip the chip onto its edge so the face points along the tray.
    chip.rotation.x = Math.PI / 2;
    chip.position.set(0, CHIP_SIZE.radius, startZ + chipIndex * chipPitch);
    channel.add(chip);
  }

  channel.userData = {
    kind: "tray-channel",
    denomination,
    chipCount,
    channelValue: denomination * chipCount,
  };
  return channel;
}

/**
 * Build the complete tray, optionally loaded with a float.
 */
export function createChipTray(options: ChipTrayOptions): THREE.Group {
  const {
    theme,
    casinoId,
    loadedDenominations = theme.chipDenominations,
    chipsPerChannel = CHIP_TRAY_SPEC.chipsPerRow,
  } = options;

  const tray = new THREE.Group();
  tray.name = `chip-tray-${casinoId}`;
  tray.add(buildTrayShell(theme));

  const channelCount = Math.min(loadedDenominations.length, CHIP_TRAY_SPEC.rowCount);
  let totalValue = 0;

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const denomination = loadedDenominations[channelIndex];
    if (denomination === undefined) {
      continue;
    }
    const channel = buildLoadedChannel(
      theme,
      casinoId,
      denomination,
      chipsPerChannel,
    );
    channel.position.set(
      channelCentreX(channelIndex),
      TRAY_BASE_THICKNESS,
      0,
    );
    tray.add(channel);
    totalValue += denomination * chipsPerChannel;
  }

  tray.userData = {
    kind: "chip-tray",
    casinoId,
    rowCount: CHIP_TRAY_SPEC.rowCount,
    chipsPerRow: chipsPerChannel,
    loadedChannels: channelCount,
    floatValue: totalValue,
    currency: theme.tableRules.currency,
  };
  return tray;
}

/** Outer footprint, useful when placing the tray on a table. */
export const CHIP_TRAY_FOOTPRINT = {
  width: TRAY_WIDTH,
  length: TRAY_OUTER_LENGTH,
  height: TRAY_BASE_THICKNESS + TRAY_WALL_HEIGHT,
} as const;
