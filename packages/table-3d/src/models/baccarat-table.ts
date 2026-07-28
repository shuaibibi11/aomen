/**
 * Complete baccarat table assembly.
 *
 * Brings together the table body, printed felt, dealer station props and one
 * drop box, positioned from DEALER_STATION_LAYOUT so the arrangement matches
 * the working-area table in the real-table spec.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import { millimetresToMetres } from "../specs/dimensions.js";
import {
  computePlayerBoxPosition,
  computeSeatPlacements,
  DEALER_STATION_LAYOUT,
  TABLE_SIZE,
  type TableVariant,
} from "../specs/table-layout.js";
import { SAMPLE_SHOE_RESULTS } from "../specs/sample-shoe.js";
import { createFeltLayoutTexture } from "../textures/felt-layout-texture.js";
import { createTableBody, TABLE_FOOTPRINT } from "./table-body.js";
import { createChipTray } from "./chip-tray.js";
import { createDealingShoe } from "./dealing-shoe.js";
import { createRoadmapMonitor } from "./roadmap-monitor.js";
import { createDiscardHolder, createLimitSign } from "./table-furniture.js";
import { createChipStack } from "./chip.js";

export interface BaccaratTableOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly variant: TableVariant;
  /** Place demo bet stacks in the seat boxes so scale is easy to judge. */
  readonly showDemoBets?: boolean;
}

/** Locked money box beneath the dealer's left hand. */
function createDropBox(theme: CasinoTheme): THREE.Group {
  const dropBox = new THREE.Group();
  dropBox.name = "drop-box";

  const width = millimetresToMetres(200);
  const depth = millimetresToMetres(150);
  const height = millimetresToMetres(60);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: "#1A1A1E",
      roughness: 0.62,
      metalness: 0.34,
    }),
  );
  body.name = "drop-box-body";
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  dropBox.add(body);

  // The visible slot cash is pushed through.
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.62, millimetresToMetres(4), depth * 0.16),
    new THREE.MeshStandardMaterial({
      color: "#050506",
      roughness: 0.9,
      metalness: 0,
    }),
  );
  slot.name = "drop-box-slot";
  slot.position.y = height;
  dropBox.add(slot);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.02, millimetresToMetres(3), depth * 1.02),
    new THREE.MeshStandardMaterial({
      color: theme.palette.gold,
      roughness: 0.4,
      metalness: 0.7,
    }),
  );
  trim.name = "drop-box-trim";
  trim.position.y = height * 0.86;
  dropBox.add(trim);

  dropBox.userData = { kind: "drop-box" };
  return dropBox;
}

/**
 * Build the whole table. Props are parented to a surface group so the entire
 * dressing sits at felt height without each factory needing to know it.
 */
export function createBaccaratTable(
  options: BaccaratTableOptions,
): THREE.Group {
  const { theme, casinoId, variant, showDemoBets = true } = options;

  const table = new THREE.Group();
  table.name = `baccarat-table-${casinoId}-${variant}`;

  const layoutTexture = createFeltLayoutTexture({ theme, variant });
  table.add(createTableBody({ theme, layoutTexture }));

  // Everything resting on the cloth shares one parent at felt height.
  const surface = new THREE.Group();
  surface.name = "table-surface-props";
  surface.position.y = TABLE_FOOTPRINT.surfaceY;
  table.add(surface);

  const tray = createChipTray({
    theme,
    casinoId,
    chipsPerChannel: 14,
  });
  tray.position.set(
    DEALER_STATION_LAYOUT.chipTray.x,
    0,
    DEALER_STATION_LAYOUT.chipTray.z,
  );
  surface.add(tray);

  const shoe = createDealingShoe({ theme, casinoId });
  shoe.position.set(
    DEALER_STATION_LAYOUT.dealingShoe.x,
    0,
    DEALER_STATION_LAYOUT.dealingShoe.z,
  );
  // Angle the mouth towards the dealer's dealing hand.
  shoe.rotation.y = -Math.PI / 12;
  surface.add(shoe);

  const discardHolder = createDiscardHolder({
    theme,
    casinoId,
    fillRatio: 0.35,
  });
  discardHolder.position.set(
    DEALER_STATION_LAYOUT.discardHolder.x,
    0,
    DEALER_STATION_LAYOUT.discardHolder.z,
  );
  surface.add(discardHolder);

  const dropBox = createDropBox(theme);
  dropBox.position.set(
    DEALER_STATION_LAYOUT.dropBox.x,
    0,
    DEALER_STATION_LAYOUT.dropBox.z,
  );
  surface.add(dropBox);

  const limitSign = createLimitSign({
    theme,
    casinoId,
    minimumBet: variant === "vip" ? 20_000 : 1_000,
    maximumBet: variant === "vip" ? 2_000_000 : 100_000,
  });
  limitSign.position.set(
    DEALER_STATION_LAYOUT.limitSign.x,
    0,
    DEALER_STATION_LAYOUT.limitSign.z,
  );
  limitSign.rotation.y = Math.PI;
  surface.add(limitSign);

  const monitor = createRoadmapMonitor({
    theme,
    casinoId,
    results: SAMPLE_SHOE_RESULTS,
  });
  monitor.position.set(
    DEALER_STATION_LAYOUT.roadmapMonitor.x,
    0,
    DEALER_STATION_LAYOUT.roadmapMonitor.z,
  );
  // Face the guests across the table.
  monitor.rotation.y = Math.PI;
  surface.add(monitor);

  if (showDemoBets) {
    surface.add(buildDemoBets(theme, casinoId, variant));
  }

  const seatPlacements = computeSeatPlacements(variant);
  table.userData = {
    kind: "baccarat-table",
    casinoId,
    variant,
    seatCount: seatPlacements.length,
    seatLabels: seatPlacements.map((seat) => seat.label),
    commission: theme.tableRules.commission,
    widthMm: 2400,
    depthMm: 1400,
  };
  return table;
}

/**
 * Drop a small stack into a few seat boxes. This is scale reference only, not
 * game state: the engine will own real bets.
 */
function buildDemoBets(
  theme: CasinoTheme,
  casinoId: CasinoId,
  variant: TableVariant,
): THREE.Group {
  const bets = new THREE.Group();
  bets.name = "demo-bets";

  const seatPlacements = computeSeatPlacements(variant);
  const stackHeights = [4, 0, 7, 2, 0, 5, 3];

  seatPlacements.forEach((seat, seatIndex) => {
    const chipCount = stackHeights[seatIndex % stackHeights.length] ?? 0;
    if (chipCount === 0) {
      return;
    }

    const denomination =
      theme.chipDenominations[seatIndex % theme.chipDenominations.length] ??
      theme.chipDenominations[0] ??
      100;

    const stack = createChipStack({
      theme,
      casinoId,
      denomination,
      count: chipCount,
    });

    // Land the stack in the printed PLAYER box, using the same rotation the
    // felt texture used to draw that box.
    const playerBox = computePlayerBoxPosition(seat);
    stack.position.set(playerBox.x, 0, playerBox.z);
    bets.add(stack);
  });

  return bets;
}

export { TABLE_FOOTPRINT, TABLE_SIZE };
