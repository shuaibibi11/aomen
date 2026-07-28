/**
 * Interactive preview scene for the procedural chip and card models.
 *
 * The scene exists to verify geometry and materials against the SVG design
 * sheets. It is not the training table: the table scene will import the same
 * model factories.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CASINO_IDS,
  getCasinoTheme,
  type CasinoId,
  type CasinoTheme,
} from "../specs/casino-theme.js";
import {
  CARD_DIMENSIONS_MM,
  CHIP_DIMENSIONS_MM,
  CHIP_STACK_COUNT,
  CHIP_TRAY_SPEC,
  MEMBER_CARD_DIMENSIONS_MM,
  PLAQUE_DIMENSIONS_MM,
} from "../specs/dimensions.js";
import { createChipModel, createChipStack } from "../models/chip.js";
import { createCardHand, createCardModel } from "../models/card.js";
import { createChipTray } from "../models/chip-tray.js";
import { createCutCard, createDealingShoe } from "../models/dealing-shoe.js";
import {
  createCommissionMarkerSet,
  createDiscardHolder,
  createLimitSign,
} from "../models/table-furniture.js";
import { createRoadmapMonitor } from "../models/roadmap-monitor.js";
import { SAMPLE_SHOE_RESULTS } from "../specs/sample-shoe.js";
import {
  createMemberCardSet,
  createPlaqueModel,
  createPlaqueStack,
} from "../models/vip-assets.js";
import {
  getMembershipProgramme,
  PLAQUE_DENOMINATIONS,
} from "../specs/vip-assets.js";
import type { CardRank, CardSuit } from "../textures/card-textures.js";

type PreviewMode =
  | "chip-set"
  | "chip-stacks"
  | "plaque-set"
  | "chip-tray"
  | "member-cards"
  | "card-faces"
  | "dealt-hand"
  | "dealing-shoe"
  | "dealer-station"
  | "roadmap";

const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  "chip-set": "籌碼全套 Chip set",
  "chip-stacks": "碼堆 Chip stacks",
  "plaque-set": "大額牌碼 Plaques",
  "chip-tray": "碼盤 Chip tray",
  "member-cards": "會員卡 Member cards",
  "card-faces": "撲克牌面 Card faces",
  "dealt-hand": "發牌手牌 Dealt hand",
  "dealing-shoe": "牌靴 Dealing shoe",
  "dealer-station": "荷官檯面 Dealer station",
  roadmap: "路單 Roadmap",
};

const SAMPLE_HAND: ReadonlyArray<{ rank: CardRank; suit: CardSuit }> = [
  { rank: "9", suit: "heart" },
  { rank: "K", suit: "spade" },
  { rank: "4", suit: "diamond" },
];

const SAMPLE_FACES: ReadonlyArray<{ rank: CardRank; suit: CardSuit }> = [
  { rank: "A", suit: "spade" },
  { rank: "7", suit: "heart" },
  { rank: "10", suit: "diamond" },
  { rank: "Q", suit: "club" },
];

export class PreviewApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly contentGroup = new THREE.Group();

  private activeCasinoId: CasinoId = "sands-venetian";
  private activeMode: PreviewMode = "chip-set";
  private turntableEnabled = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0A0A0E");

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);
    this.camera.position.set(0.16, 0.17, 0.26);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.04;
    this.controls.maxDistance = 2.5;
    this.controls.target.set(0, 0.012, 0);

    this.scene.add(this.contentGroup);
    this.buildLighting();
    this.buildFeltSurface();
    this.rebuildContent();
    this.frameActiveContent();

    window.addEventListener("resize", () => this.handleResize());
    this.handleResize();
    this.renderer.setAnimationLoop(() => this.renderFrame());
  }

  /** Three-point studio setup: key, fill and a warm rim to read the gold. */
  private buildLighting(): void {
    this.scene.add(new THREE.AmbientLight("#ffffff", 0.55));

    const keyLight = new THREE.DirectionalLight("#fff6e6", 2.6);
    keyLight.position.set(0.22, 0.4, 0.24);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.05;
    keyLight.shadow.camera.far = 1.6;
    keyLight.shadow.camera.left = -0.25;
    keyLight.shadow.camera.right = 0.25;
    keyLight.shadow.camera.top = 0.25;
    keyLight.shadow.camera.bottom = -0.25;
    keyLight.shadow.bias = -0.0004;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#dce6f0", 0.8);
    fillLight.position.set(-0.3, 0.22, 0.1);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight("#ffd9a0", 1.1);
    rimLight.position.set(-0.1, 0.16, -0.3);
    this.scene.add(rimLight);
  }

  /** A felt disc so chips and cards are read against the table colour. */
  private feltMesh: THREE.Mesh | null = null;

  private buildFeltSurface(): void {
    const geometry = new THREE.CircleGeometry(0.42, 72);
    const material = new THREE.MeshStandardMaterial({
      color: "#0E6045",
      roughness: 0.96,
      metalness: 0,
    });
    const felt = new THREE.Mesh(geometry, material);
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);
    this.feltMesh = felt;
  }

  private disposeContent(): void {
    this.contentGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const standardMaterial = material as THREE.MeshStandardMaterial;
        standardMaterial.map?.dispose();
        standardMaterial.dispose();
      }
    });
    this.contentGroup.clear();
  }

  private get activeTheme(): CasinoTheme {
    return getCasinoTheme(this.activeCasinoId);
  }

  private rebuildContent(): void {
    this.disposeContent();

    const theme = this.activeTheme;
    if (this.feltMesh !== null) {
      (this.feltMesh.material as THREE.MeshStandardMaterial).color.set(
        theme.palette.feltMain,
      );
    }

    switch (this.activeMode) {
      case "chip-set":
        this.buildChipSet(theme);
        break;
      case "chip-stacks":
        this.buildChipStacks(theme);
        break;
      case "plaque-set":
        this.buildPlaqueSet(theme);
        break;
      case "chip-tray":
        this.buildChipTray(theme);
        break;
      case "member-cards":
        this.buildMemberCards(theme);
        break;
      case "card-faces":
        this.buildCardFaces(theme);
        break;
      case "dealt-hand":
        this.buildDealtHand(theme);
        break;
      case "dealing-shoe":
        this.buildDealingShoe(theme);
        break;
      case "dealer-station":
        this.buildDealerStation(theme);
        break;
      case "roadmap":
        this.buildRoadmap(theme);
        break;
    }

    this.updateInfoPanel();
  }

  /** All denominations laid out flat in a row, face up. */
  private buildChipSet(theme: CasinoTheme): void {
    const denominations = theme.chipDenominations;
    const spacing = 0.046;
    denominations.forEach((denomination, chipIndex) => {
      const chip = createChipModel({
        theme,
        casinoId: this.activeCasinoId,
        denomination,
      });
      chip.position.set(
        (chipIndex - (denominations.length - 1) / 2) * spacing,
        0.0017,
        0,
      );
      this.contentGroup.add(chip);
    });
  }

  /** One stack per denomination, at the real twenty-chip dealer count. */
  private buildChipStacks(theme: CasinoTheme): void {
    const denominations = theme.chipDenominations;
    const spacing = 0.05;
    denominations.forEach((denomination, stackIndex) => {
      const stack = createChipStack({
        theme,
        casinoId: this.activeCasinoId,
        denomination,
        count: CHIP_STACK_COUNT,
      });
      stack.position.set(
        (stackIndex - (denominations.length - 1) / 2) * spacing,
        0,
        0,
      );
      this.contentGroup.add(stack);
    });
  }

  /** Every plaque value in a row, with a short stack to show thickness. */
  private buildPlaqueSet(theme: CasinoTheme): void {
    const spacing = 0.132;
    PLAQUE_DENOMINATIONS.forEach((denomination, plaqueIndex) => {
      const plaque = createPlaqueModel({
        theme,
        casinoId: this.activeCasinoId,
        denomination,
      });
      plaque.position.set(
        (plaqueIndex - (PLAQUE_DENOMINATIONS.length - 1) / 2) * spacing,
        0.002,
        -0.06,
      );
      this.contentGroup.add(plaque);
    });

    const topDenomination =
      PLAQUE_DENOMINATIONS[PLAQUE_DENOMINATIONS.length - 1] ?? 1_000_000;
    const stack = createPlaqueStack({
      theme,
      casinoId: this.activeCasinoId,
      denomination: topDenomination,
      count: 5,
    });
    stack.position.set(0, 0, 0.07);
    this.contentGroup.add(stack);
  }

  /** The dealer float: a loaded five-channel tray. */
  private buildChipTray(theme: CasinoTheme): void {
    const tray = createChipTray({ theme, casinoId: this.activeCasinoId });
    this.contentGroup.add(tray);
  }

  /** The full membership ladder for this casino, lowest tier on the left. */
  private buildMemberCards(theme: CasinoTheme): void {
    const cardSet = createMemberCardSet(theme, this.activeCasinoId);
    this.contentGroup.add(cardSet);
  }

  /** Sample faces plus one card turned to show the back engraving. */
  private buildCardFaces(theme: CasinoTheme): void {
    const spacing = 0.066;
    const total = SAMPLE_FACES.length + 1;

    SAMPLE_FACES.forEach((cardSpec, cardIndex) => {
      const card = createCardModel({
        theme,
        casinoId: this.activeCasinoId,
        rank: cardSpec.rank,
        suit: cardSpec.suit,
      });
      card.position.set((cardIndex - (total - 1) / 2) * spacing, 0.0002, 0);
      this.contentGroup.add(card);
    });

    const backCard = createCardModel({
      theme,
      casinoId: this.activeCasinoId,
      rank: "A",
      suit: "club",
    });
    backCard.position.set((total - 1 - (total - 1) / 2) * spacing, 0.0002, 0);
    backCard.rotation.x = Math.PI / 2;
    this.contentGroup.add(backCard);
  }

  /** A three-card hand with a small bet stack beside it. */
  private buildDealtHand(theme: CasinoTheme): void {
    const hand = createCardHand({
      theme,
      casinoId: this.activeCasinoId,
      cards: SAMPLE_HAND,
    });
    hand.position.set(0, 0.0002, -0.02);
    this.contentGroup.add(hand);

    const betDenomination = theme.chipDenominations[2] ?? theme.chipDenominations[0] ?? 100;
    const betStack = createChipStack({
      theme,
      casinoId: this.activeCasinoId,
      denomination: betDenomination,
      count: 6,
    });
    betStack.position.set(0, 0, 0.075);
    this.contentGroup.add(betStack);
  }

  /** Shoe with cut card beside it. */
  private buildDealingShoe(theme: CasinoTheme): void {
    const shoe = createDealingShoe({ theme, casinoId: this.activeCasinoId });
    this.contentGroup.add(shoe);

    const cutCard = createCutCard(theme);
    cutCard.position.set(
      0.06 + 0.015,
      0.002,
      0,
    );
    this.contentGroup.add(cutCard);
  }

  /** Dealer's working area: chip tray, shoe, discard holder, limit sign,
   *  commission markers — the complete set a trainer needs to demonstrate. */
  private buildDealerStation(theme: CasinoTheme): void {
    const tray = createChipTray({ theme, casinoId: this.activeCasinoId, chipsPerChannel: 8 });
    tray.position.set(0, 0, 0);
    this.contentGroup.add(tray);

    const shoe = createDealingShoe({ theme, casinoId: this.activeCasinoId });
    shoe.position.set(0.36, 0, 0);
    this.contentGroup.add(shoe);

    const discard = createDiscardHolder({ theme, casinoId: this.activeCasinoId, fillRatio: 0.4 });
    discard.position.set(-0.36, 0, 0);
    this.contentGroup.add(discard);

    const sign = createLimitSign({
      theme,
      casinoId: this.activeCasinoId,
      minimumBet: theme.tableRules.commission ? 500 : 500,
      maximumBet: 50000,
    });
    sign.position.set(0.6, 0, -0.04);
    this.contentGroup.add(sign);

    if (theme.tableRules.commission) {
      const markers = createCommissionMarkerSet(theme, 7);
      markers.position.set(0, 0.004, 0.24);
      this.contentGroup.add(markers);
    }
  }

  /** Roadmap monitor showing a worked sample shoe. */
  private buildRoadmap(theme: CasinoTheme): void {
    const monitor = createRoadmapMonitor({
      theme,
      casinoId: this.activeCasinoId,
      results: SAMPLE_SHOE_RESULTS,
    });
    this.contentGroup.add(monitor);
  }

  private handleResize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private renderFrame(): void {
    if (this.turntableEnabled) {
      this.contentGroup.rotation.y += 0.0035;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setCasino(casinoId: CasinoId): void {
    this.activeCasinoId = casinoId;
    this.contentGroup.rotation.y = 0;
    this.rebuildContent();
    // Tier counts differ per casino, so the member-card row changes width.
    this.frameActiveContent();
  }

  setMode(mode: PreviewMode): void {
    this.activeMode = mode;
    this.contentGroup.rotation.y = 0;
    this.rebuildContent();
    this.frameActiveContent();
  }

  /**
   * Reframe the camera around whatever is currently built. Props differ in
   * scale by an order of magnitude (a 39 mm chip versus a 360 mm tray), so a
   * fixed camera would either clip the tray or lose the chip.
   */
  private frameActiveContent(): void {
    const bounds = new THREE.Box3().setFromObject(this.contentGroup);
    if (bounds.isEmpty()) {
      return;
    }

    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const largestExtent = Math.max(size.x, size.y, size.z);

    const verticalFieldOfView = (this.camera.fov * Math.PI) / 180;
    const fitDistance = (largestExtent / 2) / Math.tan(verticalFieldOfView / 2);
    const framingMargin = 1.9;
    const cameraDistance = fitDistance * framingMargin;

    // Keep the established three-quarter viewing angle while changing distance.
    const viewDirection = new THREE.Vector3(0.42, 0.52, 0.74).normalize();
    this.camera.position.copy(centre).addScaledVector(viewDirection, cameraDistance);
    this.controls.target.copy(centre);
    this.controls.update();
  }

  setTurntable(enabled: boolean): void {
    this.turntableEnabled = enabled;
  }

  /** Write the current spec numbers into the side panel. */
  private updateInfoPanel(): void {
    const panel = document.getElementById("spec-readout");
    if (panel === null) {
      return;
    }
    const theme = this.activeTheme;
    const rows: Array<[string, string]> = [
      ["場館", theme.displayName],
      ["模式", PREVIEW_MODE_LABELS[this.activeMode]],
      [
        "籌碼尺寸",
        `⌀${CHIP_DIMENSIONS_MM.diameter} × ${CHIP_DIMENSIONS_MM.thickness} mm`,
      ],
      ["籌碼模具", theme.materials.chipMould],
      ["邊緣嵌條", `${theme.materials.chipInserts} 條`],
      [
        "撲克尺寸",
        `${CARD_DIMENSIONS_MM.width} × ${CARD_DIMENSIONS_MM.height} × ${CARD_DIMENSIONS_MM.thickness} mm`,
      ],
      ["牌背雕紋", theme.materials.cardEngrave],
      ["碼堆單位", `${CHIP_STACK_COUNT} 枚`],
      [
        "牌碼尺寸",
        `${PLAQUE_DIMENSIONS_MM.width} × ${PLAQUE_DIMENSIONS_MM.height} × ${PLAQUE_DIMENSIONS_MM.thickness} mm`,
      ],
      [
        "碼盤規格",
        `${CHIP_TRAY_SPEC.rowCount} 排 × ${CHIP_TRAY_SPEC.chipsPerRow} 枚 · 排距 ${CHIP_TRAY_SPEC.rowPitchMm} mm`,
      ],
      ["會員計劃", getMembershipProgramme(this.activeCasinoId).programmeName],
      [
        "會員等級",
        getMembershipProgramme(this.activeCasinoId)
          .tiers.map((tier) => tier.name)
          .join(" · "),
      ],
      [
        "會員卡尺寸",
        `${MEMBER_CARD_DIMENSIONS_MM.width} × ${MEMBER_CARD_DIMENSIONS_MM.height} mm（ID-1）`,
      ],
      ["幣別", `${theme.tableRules.currency}（訓練幣）`],
    ];
    panel.innerHTML = rows
      .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
      .join("");

    this.updateDiagnostics();
  }

  /**
   * Report what the renderer actually produced. Screenshots alone cannot prove
   * geometry reached the GPU, so the mesh and draw-call counts are surfaced in
   * the page for verification.
   */
  private updateDiagnostics(): void {
    const panel = document.getElementById("render-diagnostics");
    if (panel === null) {
      return;
    }

    let meshCount = 0;
    let triangleCount = 0;
    this.contentGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      meshCount += 1;
      const index = child.geometry.getIndex();
      const positionAttribute = child.geometry.getAttribute("position");
      triangleCount += index !== null
        ? index.count / 3
        : (positionAttribute?.count ?? 0) / 3;
    });

    // Render once before reading counters so the values reflect this content.
    this.renderer.render(this.scene, this.camera);
    const renderInfo = this.renderer.info.render;

    panel.textContent =
      `模型網格 ${meshCount} · 三角面 ${Math.round(triangleCount)} · ` +
      `繪製呼叫 ${renderInfo.calls}`;
  }
}

export { CASINO_IDS, PREVIEW_MODE_LABELS };
export type { PreviewMode };
