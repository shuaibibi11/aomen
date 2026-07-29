/**
 * Table session: the bridge between the 3D table and the authoritative engine.
 *
 * The engine owns all game state. This module owns nothing except the mapping
 * between the two worlds:
 *
 *   - the layout numbers seats 1..7 (and skips 13 on a big table), because that
 *     is what is printed on the cloth
 *   - the engine identifies seats by an opaque `SeatId` string
 *
 * Keeping that translation in one place means a click can be turned into a
 * `place_bet` intent without any other module needing to know both spellings.
 *
 * The session runs the engine in-process. There is no socket here on purpose:
 * wiring the click path to a local runtime first removes the network as a
 * variable, and the server already drives the same runtime the same way.
 */
import {
  asActorId,
  asSeatId,
  asTableId,
  SYSTEM_DEALER,
  type ActorId,
  type BetKind,
  type SeatId,
  type TableEvent,
  type TableSnapshot,
} from "@mct/shared";
// Type-only import: the schema module carries the RulePack shape, and importing
// only the type means neither zod nor the disk loader reaches the browser.
import type { RulePack } from "@mct/rule-packs/schema";
import { createShoe, TableRuntime } from "@mct/table-engine";
import devRulePackData from "../../../rule-packs/packs/dev/generic-macau-baccarat.v1.json";
import {
  buildSeatBetSpots,
  getSeatLabels,
  type BetSpotSpec,
  type TableVariant,
} from "../specs/table-layout.js";

/**
 * The bundled development rule pack.
 *
 * This is validated at build time, not at run time. An earlier version called
 * `validateRulePack` here, which pulled zod into the browser bundle for no
 * benefit: this pack is a JSON file committed to the repository and inlined by
 * the bundler, so it cannot be tampered with between build and run. A malformed
 * pack is a broken build, not a runtime condition to recover from.
 *
 * `table-session.test.ts` runs the real validator over this same import, so a
 * pack that does not satisfy the schema fails the test suite. That places the
 * check where it can actually be acted on while keeping the validator, and its
 * dependency, out of what ships to a browser.
 *
 * Untrusted packs — uploaded by a coach, fetched from a server — must still go
 * through `validateRulePack` at the point they enter the system.
 */
export const DEV_RULE_PACK = devRulePackData as RulePack;

export interface TableSessionOptions {
  readonly variant: TableVariant;
  readonly rulePack?: RulePack;
  /** Shoe seed; the same seed always produces the same card order. */
  readonly shoeSeed?: string;
  /** Training chips granted to the guest at each seat on open. */
  readonly startingStack?: number;
  /** Which printed seat the local guest occupies. */
  readonly guestSeatLabel?: number;
}

/** A seat as the UI needs to see it: printed number plus engine identity. */
export interface SessionSeat {
  readonly label: number;
  readonly seatId: SeatId;
  readonly occupantId: ActorId;
}

/**
 * Wraps one TableRuntime and exposes it in the terms the 3D scene works in.
 */
export class TableSession {
  private readonly runtime: TableRuntime;
  private readonly rulePack: RulePack;
  private readonly seats: readonly SessionSeat[];
  private readonly guestSeat: SessionSeat;
  private readonly seatIdByLabel = new Map<number, SeatId>();
  private readonly betSpots: readonly BetSpotSpec[];

  constructor(options: TableSessionOptions) {
    const {
      variant,
      rulePack = DEV_RULE_PACK,
      shoeSeed = "table-3d-dev-shoe",
      startingStack = rulePack.limits.min * 200,
      guestSeatLabel,
    } = options;

    this.rulePack = rulePack;

    // Printed payout labels come from the pack being enforced, so the cloth
    // cannot advertise odds the engine does not pay.
    const tiePayout = `${rulePack.mainPayouts.tie} : 1`;
    this.betSpots = buildSeatBetSpots(tiePayout, rulePack.variant === "standard");

    const tableId = asTableId(`table-3d-${variant}`);
    const seatLabels = getSeatLabels(variant);

    // Every printed seat becomes an engine seat. The guest occupies one of them
    // and the rest are seated by placeholder actors so a later bet on any seat
    // has an owner; the engine rejects a bet from an actor who is not seated.
    this.seats = seatLabels.map((label) => ({
      label,
      seatId: asSeatId(`${tableId}-seat-${label}`),
      occupantId: asActorId(`${tableId}-guest-${label}`),
    }));
    for (const seat of this.seats) {
      this.seatIdByLabel.set(seat.label, seat.seatId);
    }

    const requestedGuestSeat = guestSeatLabel ?? seatLabels[Math.floor(seatLabels.length / 2)];
    const guestSeat = this.seats.find((seat) => seat.label === requestedGuestSeat)
      ?? this.seats[0];
    if (guestSeat === undefined) {
      throw new Error("A table session needs at least one seat");
    }
    this.guestSeat = guestSeat;

    const shoe = createShoe({
      seed: shoeSeed,
      deckCount: rulePack.shoe.deckCount,
    });

    this.runtime = new TableRuntime({
      tableId,
      rulePack,
      dealerId: SYSTEM_DEALER,
      seatIds: this.seats.map((seat) => seat.seatId),
      drawCard: () => shoe.draw(),
    });

    // Fund every seat before the first round so a bet is never rejected for an
    // empty stack. Buy-in is a real intent, so the event log records it.
    for (const seat of this.seats) {
      this.runtime.submitIntent({
        type: "buy_in",
        actorId: seat.occupantId,
        seatId: seat.seatId,
        amount: startingStack,
      });
    }

    this.runtime.submitIntent({
      type: "start_round",
      actorId: SYSTEM_DEALER,
    });
  }

  getRulePack(): RulePack {
    return this.rulePack;
  }

  /**
   * The printed betting spots, built from this table's own rule pack so the
   * payout labels on the cloth match the rules being enforced.
   *
   * Both the felt texture and the hit test read this list, which is what keeps a
   * printed box and the chip that belongs in it in the same place.
   */
  getBetSpots(): readonly BetSpotSpec[] {
    return this.betSpots;
  }

  getSeats(): readonly SessionSeat[] {
    return this.seats;
  }

  /** The seat the local guest is playing, used when a click has no seat yet. */
  getGuestSeat(): SessionSeat {
    return this.guestSeat;
  }

  getSnapshot(): TableSnapshot {
    return this.runtime.getSnapshot();
  }

  getEvents(): readonly TableEvent[] {
    return this.runtime.getEvents();
  }

  /** Chips still free at a printed seat number. */
  getStack(seatLabel: number): number {
    const seatId = this.seatIdByLabel.get(seatLabel);
    if (seatId === undefined) {
      return 0;
    }
    return this.runtime.getStack(seatId);
  }

  /**
   * Place a bet from a click on the cloth.
   *
   * The caller supplies the printed seat number and the spot that was hit; this
   * resolves them to the engine's own identities and submits the intent. The
   * returned event says whether the engine accepted it, including the reason if
   * not (wrong phase, below minimum, insufficient funds), so the UI can show
   * the real rejection rather than guessing.
   */
  placeBet(seatLabel: number, betKind: BetKind, amount: number): TableEvent {
    const seat = this.seats.find((candidate) => candidate.label === seatLabel);
    if (seat === undefined) {
      throw new Error(`No seat with printed number ${seatLabel}`);
    }
    return this.runtime.submitIntent({
      type: "place_bet",
      actorId: seat.occupantId,
      seatId: seat.seatId,
      betKind,
      amount,
    });
  }

  /** Remove every bet at a printed seat number. */
  clearBets(seatLabel: number): TableEvent {
    const seat = this.seats.find((candidate) => candidate.label === seatLabel);
    if (seat === undefined) {
      throw new Error(`No seat with printed number ${seatLabel}`);
    }
    return this.runtime.submitIntent({
      type: "clear_bets",
      actorId: seat.occupantId,
      seatId: seat.seatId,
    });
  }

  /** Close betting for the round. */
  closeBetting(): TableEvent {
    return this.runtime.submitIntent({
      type: "no_more_bets",
      actorId: SYSTEM_DEALER,
    });
  }

  /** Deal one card. */
  dealNext(): TableEvent {
    return this.runtime.submitIntent({
      type: "deal_next",
      actorId: SYSTEM_DEALER,
    });
  }

  /** Settle the round and pay out. */
  settleRound(): TableEvent {
    return this.runtime.submitIntent({
      type: "settle_round",
      actorId: SYSTEM_DEALER,
    });
  }

  /** Open the next round. */
  startRound(): TableEvent {
    return this.runtime.submitIntent({
      type: "start_round",
      actorId: SYSTEM_DEALER,
    });
  }

  /**
   * Run the whole deal to completion, then settle.
   *
   * The runtime consults the draw table one card at a time, so the number of
   * cards is not known in advance; this deals until the phase leaves `dealing`.
   * The guard is a safety net, not a rule: a baccarat hand can never exceed six
   * cards, so needing more than that means the deal path is broken.
   */
  dealAndSettle(): void {
    if (this.getSnapshot().phase === "round_betting") {
      this.closeBetting();
    }

    const maximumCardsInAHand = 6;
    let dealtCards = 0;
    this.dealNext();
    while (this.getSnapshot().phase === "dealing") {
      this.dealNext();
      dealtCards += 1;
      if (dealtCards > maximumCardsInAHand) {
        throw new Error("deal did not reach settling within six cards");
      }
    }

    this.settleRound();
  }

  /** Total staked at one printed seat on one spot, from the snapshot. */
  getBetAmount(seatLabel: number, betKind: BetKind): number {
    const seatId = this.seatIdByLabel.get(seatLabel);
    if (seatId === undefined) {
      return 0;
    }
    return this.getSnapshot()
      .bets.filter((bet) => bet.seatId === seatId && bet.betKind === betKind)
      .reduce((total, bet) => total + bet.amount, 0);
  }
}
