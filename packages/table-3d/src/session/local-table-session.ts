import {
  asActorId,
  asSeatId,
  asTableId,
  SYSTEM_DEALER,
  type BetKind,
  type TableEvent,
  type TableIntent,
  type TableSnapshot,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs/schema";
import type { RoomSessionCapabilities } from "@mct/room-protocol";
import { createShoe, TableRuntime } from "@mct/table-engine";
import {
  buildSeatBetSpots,
  getSeatLabels,
  type BetSpotSpec,
} from "../specs/table-layout.js";
import { DEV_RULE_PACK } from "./dev-rule-pack.js";
import {
  createTableSessionNotifier,
  type SessionSeat,
  type TableSession,
  type TableSessionListener,
  type TableSessionOptions,
  type TableSessionUnsubscribe,
} from "./table-session.js";

/** In-process TableRuntime adapter used by the browser preview. */
export class LocalTableSession implements TableSession {
  private readonly runtime: TableRuntime;
  private readonly rulePack: RulePack;
  private readonly seats: readonly SessionSeat[];
  private readonly guestSeat: SessionSeat;
  private readonly seatIdByLabel = new Map<number, SessionSeat["seatId"]>();
  private readonly betSpots: readonly BetSpotSpec[];
  private readonly notifier = createTableSessionNotifier(() => this.getSnapshot());
  private disposed = false;

  constructor(options: TableSessionOptions) {
    const {
      variant,
      rulePack = DEV_RULE_PACK,
      shoeSeed = "table-3d-dev-shoe",
      startingStack = rulePack.limits.min * 200,
      guestSeatLabel,
    } = options;
    this.rulePack = rulePack;
    this.betSpots = buildSeatBetSpots(
      `${rulePack.mainPayouts.tie} : 1`,
      rulePack.variant === "standard",
    );

    const tableId = asTableId(`table-3d-${variant}`);
    const seatLabels = getSeatLabels(variant);
    this.seats = seatLabels.map((label) => ({
      label,
      seatId: asSeatId(`${tableId}-seat-${label}`),
      occupantId: asActorId(`${tableId}-guest-${label}`),
    }));
    for (const seat of this.seats) {
      this.seatIdByLabel.set(seat.label, seat.seatId);
    }

    const requestedGuestSeat = guestSeatLabel
      ?? seatLabels[Math.floor(seatLabels.length / 2)];
    const guestSeat = this.seats.find((seat) => seat.label === requestedGuestSeat)
      ?? this.seats[0];
    if (guestSeat === undefined) {
      throw new Error("A table session needs at least one seat");
    }
    this.guestSeat = guestSeat;

    const shoe = createShoe({ seed: shoeSeed, deckCount: rulePack.shoe.deckCount });
    this.runtime = new TableRuntime({
      tableId,
      rulePack,
      dealerId: SYSTEM_DEALER,
      seatIds: this.seats.map((seat) => seat.seatId),
      drawCard: () => shoe.draw(),
    });

    for (const seat of this.seats) {
      this.runtime.submitIntent({
        type: "buy_in",
        actorId: seat.occupantId,
        seatId: seat.seatId,
        amount: startingStack,
      });
    }
    this.runtime.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
  }

  getCapabilities(): RoomSessionCapabilities {
    return {
      canBet: true,
      canClearBets: true,
      canControlDealer: true,
    };
  }

  getRulePack(): RulePack {
    return this.rulePack;
  }

  getBetSpots(): readonly BetSpotSpec[] {
    return this.betSpots;
  }

  getSeats(): readonly SessionSeat[] {
    return this.seats;
  }

  getGuestSeat(): SessionSeat {
    return this.guestSeat;
  }

  getSnapshot(): TableSnapshot {
    return this.runtime.getSnapshot();
  }

  getEvents(): readonly TableEvent[] {
    return this.runtime.getEvents();
  }

  getStack(seatLabel: number): number {
    const seatId = this.seatIdByLabel.get(seatLabel);
    return seatId === undefined ? 0 : this.runtime.getStack(seatId);
  }

  getBetAmount(seatLabel: number, betKind: BetKind): number {
    const seatId = this.seatIdByLabel.get(seatLabel);
    if (seatId === undefined) {
      return 0;
    }
    return this.getSnapshot().bets
      .filter((bet) => bet.seatId === seatId && bet.betKind === betKind)
      .reduce((total, bet) => total + bet.amount, 0);
  }

  async placeBet(
    seatLabel: number,
    betKind: BetKind,
    amount: number,
  ): Promise<TableEvent> {
    const seat = this.requireSeat(seatLabel);
    return this.submitIntent({
      type: "place_bet",
      actorId: seat.occupantId,
      seatId: seat.seatId,
      betKind,
      amount,
    });
  }

  async clearBets(seatLabel: number): Promise<TableEvent> {
    const seat = this.requireSeat(seatLabel);
    return this.submitIntent({
      type: "clear_bets",
      actorId: seat.occupantId,
      seatId: seat.seatId,
    });
  }

  closeBetting(): Promise<TableEvent> {
    return this.submitIntent({ type: "no_more_bets", actorId: SYSTEM_DEALER });
  }

  dealNext(): Promise<TableEvent> {
    return this.submitIntent({ type: "deal_next", actorId: SYSTEM_DEALER });
  }

  settleRound(): Promise<TableEvent> {
    return this.submitIntent({ type: "settle_round", actorId: SYSTEM_DEALER });
  }

  startRound(): Promise<TableEvent> {
    return this.submitIntent({ type: "start_round", actorId: SYSTEM_DEALER });
  }

  async dealAndSettle(): Promise<void> {
    if (this.getSnapshot().phase === "round_betting") {
      await this.closeBetting();
    }

    const maximumCardsInAHand = 6;
    let dealtCards = 0;
    await this.dealNext();
    while (this.getSnapshot().phase === "dealing") {
      await this.dealNext();
      dealtCards += 1;
      if (dealtCards > maximumCardsInAHand) {
        throw new Error("deal did not reach settling within six cards");
      }
    }
    await this.settleRound();
  }

  subscribe(listener: TableSessionListener): TableSessionUnsubscribe {
    return this.notifier.subscribe(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.notifier.dispose();
  }

  private requireSeat(seatLabel: number): SessionSeat {
    const seat = this.seats.find((candidate) => candidate.label === seatLabel);
    if (seat === undefined) {
      throw new Error(`No seat with printed number ${seatLabel}`);
    }
    return seat;
  }

  private async submitIntent(intent: TableIntent): Promise<TableEvent> {
    await Promise.resolve();
    if (this.disposed) {
      throw new Error("Table session is disposed");
    }
    const event = this.runtime.submitIntent(intent);
    this.notifier.publish(event);
    return event;
  }
}
