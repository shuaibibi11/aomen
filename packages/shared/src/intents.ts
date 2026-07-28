/**
 * Table intents: everything an actor can ask the table to do.
 *
 * An intent is a *request*, not a fact. The TableRuntime decides whether to
 * accept it and records the decision as an event. Every intent names its actor
 * so the runtime can enforce who is allowed to do what (only a dealer may stop
 * betting or deal; a player may only bet on their own seat).
 */
import type { BetKind } from "./bets.js";
import type { ActorId, SeatId } from "./ids.js";

/** Place a bet of `amount` training chips on `betKind` at `seatId`. */
export interface PlaceBetIntent {
  readonly type: "place_bet";
  readonly actorId: ActorId;
  readonly seatId: SeatId;
  readonly betKind: BetKind;
  readonly amount: number;
}

/** Remove all of the actor's unconfirmed bets at a seat. */
export interface ClearBetsIntent {
  readonly type: "clear_bets";
  readonly actorId: ActorId;
  readonly seatId: SeatId;
}

/** Dealer closes betting for the round. */
export interface NoMoreBetsIntent {
  readonly type: "no_more_bets";
  readonly actorId: ActorId;
}

/** Dealer advances the deal by one card / one step. */
export interface DealNextIntent {
  readonly type: "deal_next";
  readonly actorId: ActorId;
}

/** Reveal a squeezed card (peek). Reserved for the squeeze flow. */
export interface RevealIntent {
  readonly type: "reveal";
  readonly actorId: ActorId;
}

/** Dealer settles the round: compute outcome and pay/collect. */
export interface SettleRoundIntent {
  readonly type: "settle_round";
  readonly actorId: ActorId;
}

/** Dealer (or system) opens the next round. */
export interface StartRoundIntent {
  readonly type: "start_round";
  readonly actorId: ActorId;
}

/** A guest buys in for `amount` training chips at a seat. */
export interface BuyInIntent {
  readonly type: "buy_in";
  readonly actorId: ActorId;
  readonly seatId: SeatId;
  readonly amount: number;
}

/** A guest cashes out their remaining stack. */
export interface CashOutIntent {
  readonly type: "cash_out";
  readonly actorId: ActorId;
  readonly seatId: SeatId;
}

/** Every intent the table understands. */
export type TableIntent =
  | PlaceBetIntent
  | ClearBetsIntent
  | NoMoreBetsIntent
  | DealNextIntent
  | RevealIntent
  | SettleRoundIntent
  | StartRoundIntent
  | BuyInIntent
  | CashOutIntent;

export type TableIntentType = TableIntent["type"];
