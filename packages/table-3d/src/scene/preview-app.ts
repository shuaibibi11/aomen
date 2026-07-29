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
import { createBaccaratTable } from "../models/baccarat-table.js";
import { SAMPLE_SHOE_RESULTS } from "../specs/sample-shoe.js";
import {
  computeSeatPlacements,
  TABLE_DIMENSIONS_MM,
  type TableVariant,
} from "../specs/table-layout.js";
import { buildTableViews, type TableViewId } from "../specs/table-views.js";
import { BetInteraction, type BetAttempt } from "./bet-interaction.js";
import type {
  TableSession,
  TableSessionFactory,
  TableSessionUnsubscribe,
} from "../session/table-session.js";
import {
  createLocalTableSession,
  TableSessionController,
} from "../session/session-factory.js";
import { TABLE_FOOTPRINT } from "../models/table-body.js";
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
  | "roadmap"
  | "table-mass"
  | "table-vip";

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
  "table-mass": "大眾廳牌桌 Mass table",
  "table-vip": "貴賓廳牌桌 VIP table",
};

/** Modes that build a full table and therefore use the named camera views. */
const TABLE_MODE_VARIANTS: Partial<Record<PreviewMode, TableVariant>> = {
  "table-mass": "mass",
  "table-vip": "vip",
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
  private activeTableViewId: TableViewId = "guest";

  /**
   * The live betting session, present only while a table mode is active.
   *
   * It is rebuilt with the table because a session owns a shoe and a runtime:
   * switching hall type or casino starts a new table, not a new view of the old
   * one.
   */
  private betInteraction: BetInteraction | null = null;
  private readonly sessionController: TableSessionController;
  private unsubscribeTableSession: TableSessionUnsubscribe | null = null;
  private contentBuildSequence = 0;
  private tableCommandPending = false;
  private onBetAttempt: ((attempt: BetAttempt) => void) | null = null;
  private onCommandError: ((error: unknown) => void) | null = null;
  private onTableStateChanged: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sessionFactory: TableSessionFactory = createLocalTableSession,
  ) {
    this.sessionController = new TableSessionController(sessionFactory);
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

    // Betting clicks are only meaningful on a table; the handler no-ops
    // otherwise. Using pointerdown rather than click means a drag that started
    // on a spot does not place a bet when the orbit gesture ends.
    canvas.addEventListener("pointerdown", (event) => {
      this.handleCanvasPointerDown(event);
    });

    this.renderer.setAnimationLoop(() => this.renderFrame());
  }

  /**
   * Route a canvas press to the betting session.
   *
   * Only the primary button bets: the middle and right buttons drive the orbit
   * controls, and treating them as bets would place chips while the camera moves.
   */
  private handleCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.betInteraction === null) {
      return;
    }
    const interaction = this.betInteraction;
    void interaction
      .handlePointerDown(event, this.canvas, this.camera)
      .catch((error: unknown) => {
        if (this.betInteraction === interaction) {
          this.onCommandError?.(error);
        }
      });
  }

  /** Three-point studio setup: key, fill and a warm rim to read the gold. */
  private buildLighting(): void {
    this.scene.add(new THREE.AmbientLight("#ffffff", 0.55));

    const keyLight = new THREE.DirectionalLight("#fff6e6", 2.6);
    keyLight.name = "key-light";
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
    void this.rebuildContentAsync();
  }

  private async rebuildContentAsync(): Promise<void> {
    const contentBuildSequence = ++this.contentBuildSequence;

    try {
      this.disableTableInteraction();
      this.disposeContent();
      const theme = this.activeTheme;
      if (this.feltMesh !== null) {
        (this.feltMesh.material as THREE.MeshStandardMaterial).color.set(
          theme.palette.feltMain,
        );
      }

      if (TABLE_MODE_VARIANTS[this.activeMode] === undefined) {
        this.sessionController.dispose();
        this.applyPropLighting();
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
        case "table-mass":
          await this.buildFullTable(theme, "mass", contentBuildSequence);
          break;
        case "table-vip":
          await this.buildFullTable(theme, "vip", contentBuildSequence);
          break;
      }

      if (contentBuildSequence === this.contentBuildSequence) {
        this.updateInfoPanel();
        if (this.betInteraction !== null && this.unsubscribeTableSession !== null) {
          this.onTableStateChanged?.();
        }
      }
    } catch (error) {
      if (contentBuildSequence !== this.contentBuildSequence) {
        return;
      }
      try {
        this.disableTableInteraction();
        this.disposeContent();
      } catch {
        // Preserve and report the original rebuild failure after best-effort cleanup.
      }
      this.onCommandError?.(error);
      this.onTableStateChanged?.();
    }
  }

  /** Disable all command paths before an asynchronous replacement can begin. */
  private disableTableInteraction(): void {
    this.betInteraction?.dispose();
    this.betInteraction = null;
    this.unsubscribeTableSession?.();
    this.unsubscribeTableSession = null;
    this.tableCommandPending = false;
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

  /**
   * The complete table, wired to a live engine session.
   *
   * The demo bets are switched off here: once the engine is driving, the chips
   * on the cloth have to come from the snapshot, otherwise the table would show
   * stakes that no runtime is holding.
   */
  private async buildFullTable(
    theme: CasinoTheme,
    variant: TableVariant,
    contentBuildSequence: number,
  ): Promise<void> {
    const session = await this.sessionController.open({ variant });
    if (session === null || contentBuildSequence !== this.contentBuildSequence) {
      return;
    }
    const table = createBaccaratTable({
      theme,
      casinoId: this.activeCasinoId,
      variant,
      showDemoBets: false,
    });
    this.contentGroup.add(table);

    this.betInteraction?.dispose();
    this.betInteraction = null;
    this.tableCommandPending = false;
    const interaction = new BetInteraction({
      session,
      theme,
      casinoId: this.activeCasinoId,
      variant,
      surfaceY: TABLE_FOOTPRINT.surfaceY,
      onBetAttempt: (attempt) => {
        if (this.betInteraction === interaction) {
          this.onBetAttempt?.(attempt);
        }
      },
      onCommandError: (error) => {
        if (this.betInteraction === interaction) {
          this.onCommandError?.(error);
        }
      },
      onPendingChanged: (pending) => {
        if (this.betInteraction !== interaction) {
          return;
        }
        this.tableCommandPending = pending;
        this.onTableStateChanged?.();
      },
    });
    interaction.attachToTable(table);
    table.add(interaction.chipGroup);
    table.add(interaction.cardGroup);
    this.betInteraction = interaction;
    this.unsubscribeTableSession?.();
    this.unsubscribeTableSession = session.subscribe(() => {
      this.updateInfoPanel();
      this.onTableStateChanged?.();
    });

    // The prop-preview felt disc would intersect the table legs.
    if (this.feltMesh !== null) {
      this.feltMesh.visible = false;
    }
    this.applyRoomLighting();
  }

  /**
   * Widen the key light for a 2.4 m table. The prop rig is scaled for a 39 mm
   * chip, so its shadow frustum would clip most of the table away.
   */
  private applyRoomLighting(): void {
    const keyLight = this.scene.getObjectByName("key-light");
    if (!(keyLight instanceof THREE.DirectionalLight)) {
      return;
    }
    keyLight.position.set(1.4, 3.2, 1.6);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    keyLight.shadow.camera.left = -2.2;
    keyLight.shadow.camera.right = 2.2;
    keyLight.shadow.camera.top = 2.2;
    keyLight.shadow.camera.bottom = -2.2;
    keyLight.shadow.camera.updateProjectionMatrix();
  }

  /** Restore the close-up prop rig used by every non-table mode. */
  private applyPropLighting(): void {
    if (this.feltMesh !== null) {
      this.feltMesh.visible = true;
    }
    const keyLight = this.scene.getObjectByName("key-light");
    if (!(keyLight instanceof THREE.DirectionalLight)) {
      return;
    }
    keyLight.position.set(0.22, 0.4, 0.24);
    keyLight.shadow.camera.near = 0.05;
    keyLight.shadow.camera.far = 1.6;
    keyLight.shadow.camera.left = -0.25;
    keyLight.shadow.camera.right = 0.25;
    keyLight.shadow.camera.top = 0.25;
    keyLight.shadow.camera.bottom = -0.25;
    keyLight.shadow.camera.updateProjectionMatrix();
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
    // A full table has a fixed orientation; the turntable only helps small props.
    this.turntableEnabled =
      this.turntableEnabled && TABLE_MODE_VARIANTS[mode] === undefined;
    this.rebuildContent();
    this.frameActiveContent();
    // Switching in or out of a table creates or destroys the session, so the
    // betting panel has to be told: it was built before any table existed and
    // would otherwise stay hidden for the whole session.
    this.onTableStateChanged?.();
  }

  /**
   * The live scene graph, exposed so verification tooling can raycast against
   * the real meshes instead of trusting the layout constants.
   */
  get sceneGraph(): THREE.Scene {
    return this.scene;
  }

  /**
   * The camera currently rendering, exposed so verification tooling can project
   * a world position to the same screen pixel a user would click.
   */
  get activeCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** The canvas being rendered into, for turning projections into real clicks. */
  get renderCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Which hall type is on screen, or null when no table is being shown. */
  getTableVariant(): TableVariant | null {
    return TABLE_MODE_VARIANTS[this.activeMode] ?? null;
  }

  /**
   * The live betting session, or null when no table mode is active.
   *
   * Exposed so the control panel can read engine state directly. Nothing about
   * the game is mirrored into this class: the panel asks the session, which asks
   * the runtime, so there is no second copy of the truth to fall out of step.
   */
  getBetSession(): TableSession | null {
    return this.betInteraction?.getSession() ?? null;
  }

  getSelectedDenomination(): number | null {
    return this.betInteraction?.getSelectedDenomination() ?? null;
  }

  setSelectedDenomination(denomination: number): void {
    this.betInteraction?.setSelectedDenomination(denomination);
  }

  /** Close betting, deal the hand to completion and settle it. */
  async playRoundToSettlement(): Promise<void> {
    await this.betInteraction?.playRoundToSettlement();
  }

  /** Open the next round, clearing the cloth. */
  async startNextRound(): Promise<void> {
    await this.betInteraction?.startNextRound();
  }

  /** Take back every bet the guest has placed this round. */
  async clearGuestSeatBets(): Promise<void> {
    const session = this.getBetSession();
    if (session === null) {
      return;
    }
    await this.betInteraction?.clearSeatBets(session.getGuestSeat().label);
  }

  isTableCommandPending(): boolean {
    return this.tableCommandPending;
  }

  /** Report the outcome of each click that landed on a betting spot. */
  setBetAttemptHandler(handler: (attempt: BetAttempt) => void): void {
    this.onBetAttempt = handler;
  }

  /** Report asynchronous table command failures to the control panel. */
  setCommandErrorHandler(handler: (error: unknown) => void): void {
    this.onCommandError = handler;
  }

  /** Notify the UI whenever engine state changed and should be re-read. */
  setTableStateHandler(handler: () => void): void {
    this.onTableStateChanged = handler;
  }

  /** The live betting session, or null when no table is on screen. */
  get activeBetInteraction(): BetInteraction | null {
    return this.betInteraction;
  }

  /** Report every bet attempt, accepted or rejected, to the UI. */
  setBetAttemptListener(listener: (attempt: BetAttempt) => void): void {
    this.onBetAttempt = listener;
  }

  /** Called whenever the engine state changed, so the UI can re-read it. */
  setTableStateListener(listener: () => void): void {
    this.onTableStateChanged = listener;
  }

  setTableView(viewId: TableViewId): void {
    this.activeTableViewId = viewId;
    const tableVariant = TABLE_MODE_VARIANTS[this.activeMode];
    if (tableVariant !== undefined) {
      this.applyTableView(tableVariant, viewId);
    }
  }

  /** Move the camera to one of the named table viewpoints. */
  private applyTableView(variant: TableVariant, viewId: TableViewId): void {
    const view = buildTableViews(variant).find((entry) => entry.id === viewId);
    if (view === undefined) {
      return;
    }

    // A 2.4 m table needs a much longer clip range than a 39 mm chip.
    this.camera.near = 0.05;
    this.camera.far = 60;
    this.camera.fov = viewId === "guest" ? 52 : 44;
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 12;
    this.camera.position.copy(view.cameraPosition);
    this.controls.target.copy(view.target);
    this.controls.update();
  }

  /**
   * Reframe the camera around whatever is currently built. Props differ in
   * scale by an order of magnitude (a 39 mm chip versus a 360 mm tray), so a
   * fixed camera would either clip the tray or lose the chip.
   */
  private frameActiveContent(): void {
    const tableVariant = TABLE_MODE_VARIANTS[this.activeMode];
    if (tableVariant !== undefined) {
      this.applyTableView(tableVariant, this.activeTableViewId);
      return;
    }

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
      [
        "牌桌尺寸",
        `${TABLE_DIMENSIONS_MM.width} × ${TABLE_DIMENSIONS_MM.depth} mm · 檯面高 ${TABLE_DIMENSIONS_MM.surfaceHeight} mm`,
      ],
      [
        "座位",
        computeSeatPlacements(TABLE_MODE_VARIANTS[this.activeMode] ?? "mass")
          .map((seat) => seat.label)
          .join(" · "),
      ],
      ["佣金格", theme.tableRules.commission ? "有（每座一格）" : "無（免佣桌）"],
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

export { buildTableViews, CASINO_IDS, PREVIEW_MODE_LABELS, TABLE_MODE_VARIANTS };
export type { PreviewMode, TableViewId };
