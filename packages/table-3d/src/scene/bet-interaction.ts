/**
 * Click-to-bet interaction for the 3D table.
 *
 * The chain a click travels:
 *
 *   pointer (screen) → raycast onto the felt mesh → world position
 *     → findBetSpotAtWorldPosition → printed seat number + BetKind
 *     → TableSession.placeBet → engine decides → event
 *     → snapshot → rendered chip stacks
 *
 * The engine is authoritative at every step: this module never decides whether
 * a bet is legal, it only asks. A rejection comes back with the engine's own
 * reason, which is what the UI reports, so the felt cannot show a bet the
 * engine did not accept.
 *
 * Raycasting against the real felt mesh (rather than intersecting a maths plane)
 * is deliberate: it is the same technique the felt-mapping verifier uses, so the
 * hit position is read through the same geometry the printed spots were mapped
 * onto.
 */
import * as THREE from "three";
import type { BetKind } from "@mct/shared";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import { CARD_SIZE, CHIP_SIZE, millimetresToMetres } from "../specs/dimensions.js";
import {
  computeSeatPlacements,
  findBetSpotAtWorldPosition,
  seatLocalToWorld,
  type BetSpotHit,
  type SeatPlacement,
  type TableVariant,
} from "../specs/table-layout.js";
import { createCardModel } from "../models/card.js";
import { createChipStack } from "../models/chip.js";
import type { CardRank, CardSuit } from "../textures/card-textures.js";
import type { TableSession, TableSessionUnsubscribe } from "../session/table-session.js";

/**
 * Where the dealt hands sit, as offsets from the table centre in metres.
 *
 * The two hands are dealt into the middle of the cloth, between the dealer's
 * working area and the guest betting blocks, which is where a real caller places
 * them so every seat can see both hands.
 */
const HAND_CENTRE_OFFSET_X = millimetresToMetres(210);
const DEALT_HAND_Z = millimetresToMetres(-40);

/** What the UI needs to know after a click. */
export interface BetAttempt {
  readonly hit: BetSpotHit;
  readonly amount: number;
  readonly accepted: boolean;
  readonly rejectReason: string | null;
}

export interface BetInteractionOptions {
  readonly session: TableSession;
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly variant: TableVariant;
  /** Felt height in world Y, so chips rest on the cloth. */
  readonly surfaceY: number;
  /** Called after every click that landed on a betting spot. */
  readonly onBetAttempt?: (attempt: BetAttempt) => void;
  /** Called when command pending state changes. */
  readonly onPendingChanged?: (pending: boolean) => void;
  /** Called once when an active asynchronous command fails. */
  readonly onCommandError?: (error: unknown) => void;
}

/**
 * Owns the live session and the chip meshes that visualise its bets.
 *
 * The rendered chips are rebuilt from the snapshot rather than incremented on
 * click, so what is on the cloth is always what the engine holds. If a bet were
 * rejected, nothing would appear, because nothing changed in the snapshot.
 */
export class BetInteraction {
  private readonly session: TableSession;
  private readonly unsubscribeSession: TableSessionUnsubscribe;
  private readonly seatPlacements: readonly SeatPlacement[];
  private readonly betChipGroup = new THREE.Group();
  private readonly dealtCardGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private feltMesh: THREE.Mesh | null = null;
  private selectedDenomination: number;
  private commandPending = false;
  private commandGeneration = 0;
  private disposed = false;

  constructor(private readonly options: BetInteractionOptions) {
    this.session = options.session;
    this.seatPlacements = computeSeatPlacements(options.variant);
    this.betChipGroup.name = "engine-bet-chips";
    this.betChipGroup.position.y = options.surfaceY;
    this.dealtCardGroup.name = "engine-dealt-cards";
    this.dealtCardGroup.position.y = options.surfaceY;

    const denominations = this.session.getRulePack().chipset.denominations;
    // Default to the smallest denomination that satisfies the table minimum.
    this.selectedDenomination =
      denominations.find(
        (value) => value >= this.session.getRulePack().limits.min,
      ) ?? this.session.getRulePack().limits.min;
    this.unsubscribeSession = this.session.subscribe(() => {
      this.refreshFromSnapshot();
    });
  }

  /** The group holding the chips that represent live engine bets. */
  get chipGroup(): THREE.Group {
    return this.betChipGroup;
  }

  /** The group holding the cards the engine has dealt this round. */
  get cardGroup(): THREE.Group {
    return this.dealtCardGroup;
  }

  getSession(): TableSession {
    return this.session;
  }

  getSelectedDenomination(): number {
    return this.selectedDenomination;
  }

  setSelectedDenomination(denomination: number): void {
    this.selectedDenomination = denomination;
  }

  isPending(): boolean {
    return this.commandPending;
  }

  /**
   * Point the interaction at the felt mesh of the table currently in the scene.
   * Called after the table is rebuilt, since a rebuild replaces the mesh.
   */
  attachToTable(tableRoot: THREE.Object3D): void {
    const felt = tableRoot.getObjectByName("table-felt");
    this.feltMesh = felt instanceof THREE.Mesh ? felt : null;
    this.refreshFromSnapshot();
  }

  /**
   * Resolve a pointer event to a betting spot and submit it to the engine.
   * Returns null when the click did not land on a spot.
   */
  async handlePointerDown(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
  ): Promise<BetAttempt | null> {
    if (this.feltMesh === null) {
      return null;
    }

    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    this.pointerNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(this.pointerNdc, camera);
    const hits = this.raycaster.intersectObject(this.feltMesh, false);
    const nearestHit = hits[0];
    if (nearestHit === undefined) {
      return null;
    }

    // The felt may be nested under transformed parents, so convert the world
    // hit point into the table's own frame before testing it against the layout.
    const localPoint = this.feltMesh.parent === null
      ? nearestHit.point.clone()
      : this.feltMesh.parent.worldToLocal(nearestHit.point.clone());

    const spotHit = findBetSpotAtWorldPosition(
      localPoint.x,
      localPoint.z,
      this.seatPlacements,
    );
    if (spotHit === null) {
      return null;
    }

    return this.placeBetAtSpot(spotHit);
  }

  /** Submit a bet and wait for its authoritative session update. */
  async placeBetAtSpot(hit: BetSpotHit): Promise<BetAttempt | null> {
    if (this.disposed || this.commandPending) {
      return null;
    }
    const commandGeneration = ++this.commandGeneration;
    this.setCommandPending(true);
    const amount = this.selectedDenomination;
    try {
      const event = await this.session.placeBet(
        hit.seatLabel,
        hit.spotId as BetKind,
        amount,
      );
      if (!this.isCurrentCommand(commandGeneration)) {
        return null;
      }
      const attempt: BetAttempt = {
        hit,
        amount,
        accepted: event.accepted ?? false,
        rejectReason: event.rejectReason ?? null,
      };
      this.options.onBetAttempt?.(attempt);
      return attempt;
    } catch (error) {
      if (this.isCurrentCommand(commandGeneration)) {
        this.options.onCommandError?.(error);
      }
      return null;
    } finally {
      if (this.isCurrentCommand(commandGeneration)) {
        this.setCommandPending(false);
      }
    }
  }

  /** Clear every bet at one printed seat. */
  async clearSeatBets(seatLabel: number): Promise<void> {
    await this.runCommand(() => this.session.clearBets(seatLabel));
  }

  /** Close betting, deal the hand out and settle it. */
  async playRoundToSettlement(): Promise<void> {
    await this.runCommand(async () => {
      if (this.session.getSnapshot().phase === "round_betting") {
        await this.session.closeBetting();
      }
      const maximumCards = 6;
      let cardsDealt = 0;
      await this.session.dealNext();
      while (this.session.getSnapshot().phase === "dealing") {
        await this.session.dealNext();
        cardsDealt += 1;
        if (cardsDealt > maximumCards) {
          throw new Error("deal did not reach settling within six cards");
        }
      }
      await this.session.settleRound();
    });
  }

  /** Open the next round, which also clears the cloth. */
  async startNextRound(): Promise<void> {
    await this.runCommand(() => this.session.startRound());
  }

  /**
   * Re-read the snapshot and rebuild everything it drives.
   *
   * Chips and cards are refreshed together from one read, so the cloth can never
   * show bets from one moment and cards from another.
   */
  private refreshFromSnapshot(): void {
    this.refreshBetChips();
    this.refreshDealtCards();
  }

  /**
   * Rebuild every chip stack from the snapshot.
   *
   * Rebuilding wholesale is cheap at this scale (a handful of stacks) and keeps
   * one invariant that incremental updates would eventually break: what is on
   * the cloth is exactly what the engine holds.
   */
  private refreshBetChips(): void {
    this.disposeBetChips();

    const snapshot = this.session.getSnapshot();
    const seatByEngineId = new Map(
      this.session.getSeats().map((seat) => [seat.seatId, seat.label]),
    );

    // Sum by seat and spot: several clicks on one spot are one visible stack.
    const stakeBySpot = new Map<string, number>();
    for (const bet of snapshot.bets) {
      const seatLabel = seatByEngineId.get(bet.seatId);
      if (seatLabel === undefined) {
        continue;
      }
      const key = `${seatLabel}|${bet.betKind}`;
      stakeBySpot.set(key, (stakeBySpot.get(key) ?? 0) + bet.amount);
    }

    for (const [key, totalStake] of stakeBySpot) {
      const [seatLabelText, betKind] = key.split("|");
      if (seatLabelText === undefined || betKind === undefined) {
        continue;
      }
      const seatLabel = Number(seatLabelText);
      const seat = this.seatPlacements.find(
        (candidate) => candidate.label === seatLabel,
      );
      if (seat === undefined) {
        continue;
      }

      const spot = this.session
        .getBetSpots()
        .find((candidate) => candidate.id === betKind);
      if (spot === undefined) {
        continue;
      }

      const chipCount = Math.max(
        1,
        Math.round(totalStake / this.selectedDenomination),
      );
      const stack = createChipStack({
        theme: this.options.theme,
        casinoId: this.options.casinoId,
        denomination: this.selectedDenomination,
        count: Math.min(chipCount, 20),
      });
      const world = seatLocalToWorld(seat, spot.localX, spot.localZ);
      stack.position.set(world.x, CHIP_SIZE.thickness * 0.5, world.z);
      this.betChipGroup.add(stack);
    }
  }

  /**
   * Rebuild the two dealt hands from the snapshot.
   *
   * The engine decides how many cards each hand gets, consulting the third-card
   * rules one card at a time, so this reads whatever the snapshot holds rather
   * than assuming two or three. Cards sit in front of the dealer, player hand to
   * the guests' left of centre and banker hand to the right, which is how a real
   * baccarat layout presents them.
   */
  private refreshDealtCards(): void {
    this.disposeDealtCards();

    const { hands } = this.session.getSnapshot();
    const handSpread = CARD_SIZE.width * 0.72;

    const layOutHand = (
      cards: readonly { rank: CardRank; suit: CardSuit }[],
      centreX: number,
    ): void => {
      cards.forEach((card, cardIndex) => {
        const cardMesh = createCardModel({
          theme: this.options.theme,
          casinoId: this.options.casinoId,
          rank: card.rank,
          suit: card.suit,
        });
        // Fan sideways from the hand centre, lifting each card a hair so they
        // do not z-fight where they overlap.
        cardMesh.position.set(
          centreX + (cardIndex - (cards.length - 1) / 2) * handSpread,
          CARD_SIZE.thickness * (cardIndex + 1),
          DEALT_HAND_Z,
        );
        this.dealtCardGroup.add(cardMesh);
      });
    };

    layOutHand(hands.player, -HAND_CENTRE_OFFSET_X);
    layOutHand(hands.banker, HAND_CENTRE_OFFSET_X);
  }

  private disposeBetChips(): void {
    disposeGroupContents(this.betChipGroup);
  }

  private disposeDealtCards(): void {
    disposeGroupContents(this.dealtCardGroup);
  }

  /** Release GPU resources when the mode changes away from a table. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.commandGeneration += 1;
    this.commandPending = false;
    this.unsubscribeSession();
    this.disposeBetChips();
    this.disposeDealtCards();
  }

  private async runCommand(command: () => Promise<unknown>): Promise<void> {
    if (this.disposed || this.commandPending) {
      return;
    }
    const commandGeneration = ++this.commandGeneration;
    this.setCommandPending(true);
    try {
      await command();
    } catch (error) {
      if (this.isCurrentCommand(commandGeneration)) {
        this.options.onCommandError?.(error);
      }
    } finally {
      if (this.isCurrentCommand(commandGeneration)) {
        this.setCommandPending(false);
      }
    }
  }

  private isCurrentCommand(commandGeneration: number): boolean {
    return !this.disposed && commandGeneration === this.commandGeneration;
  }

  private setCommandPending(pending: boolean): void {
    this.commandPending = pending;
    this.options.onPendingChanged?.(pending);
  }
}

/**
 * Free the geometry and textures under a group, then empty it.
 *
 * Every rebuild discards meshes that own canvas textures. Without this the
 * textures would accumulate on the GPU, which matters here because a card
 * texture is drawn per card and a round can be replayed many times.
 */
function disposeGroupContents(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      const standardMaterial = material as THREE.MeshStandardMaterial;
      standardMaterial.map?.dispose();
      standardMaterial.dispose();
    }
  });
  group.clear();
}
