/**
 * TableRuntime: the authoritative baccarat state machine.
 *
 * This is where the pieces meet. A round moves through fixed phases —
 *
 *   shoe_ready → round_betting → no_more_bets → dealing → settling → round_end
 *
 * — and every intent is checked against the current phase and the actor's role
 * before it is applied. Each accepted or rejected intent is appended to an
 * event log with a monotonic sequence number, which is the record a replay or a
 * grader reads.
 *
 * The deal path consults the real draw table (isNatural, playerDrawsThird,
 * bankerDrawsThird) one card at a time; it never stops at two cards and calls
 * the hand done. Cards come from an injected `drawCard`, so a test can feed a
 * fixed sequence and a live table can feed a seeded shoe.
 */
import {
  asRoundId,
  baccaratCardValue,
  baccaratHandTotal,
  type ActorId,
  type BetKind,
  type Card,
  type RejectReason,
  type RoundId,
  type RoundOutcome,
  type SeatId,
  type TableEvent,
  type TableId,
  type TableIntent,
  type TablePhase,
  type TableSnapshot,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs";
import {
  bankerDrawsThird,
  isNatural,
  playerDrawsThird,
} from "./baccarat/draw-table.js";
import {
  computeMainBetPayout,
  computeSideBetPayout,
  isMainBet,
} from "./baccarat/payout.js";
import { ChipLedger } from "./chip-ledger.js";

export interface TableRuntimeOptions {
  readonly tableId: TableId;
  readonly rulePack: RulePack;
  readonly dealerId: ActorId;
  readonly seatIds: readonly SeatId[];
  /** Source of cards. A test injects a fixed queue; a table injects a shoe. */
  readonly drawCard: () => Card;
  /** Clock, injectable so events have deterministic timestamps in tests. */
  readonly now?: () => number;
}

/** One placed bet held for settlement. */
interface PlacedBet {
  readonly seatId: SeatId;
  readonly betKind: BetKind;
  readonly amount: number;
}

export class TableRuntime {
  private readonly tableId: TableId;
  private readonly rulePack: RulePack;
  private readonly dealerId: ActorId;
  private readonly seatIds: readonly SeatId[];
  private readonly drawCard: () => Card;
  private readonly now: () => number;
  private readonly ledger = new ChipLedger();

  private phase: TablePhase = "shoe_ready";
  private roundCounter = 0;
  private roundId: RoundId;
  private seq = 0;
  private readonly events: TableEvent[] = [];

  /** Which actor occupies each seat, set at buy-in. */
  private readonly occupants = new Map<SeatId, ActorId>();

  private playerCards: Card[] = [];
  private bankerCards: Card[] = [];
  private bets: PlacedBet[] = [];
  private outcome: RoundOutcome | null = null;

  constructor(options: TableRuntimeOptions) {
    this.tableId = options.tableId;
    this.rulePack = options.rulePack;
    this.dealerId = options.dealerId;
    this.seatIds = options.seatIds;
    this.drawCard = options.drawCard;
    this.now = options.now ?? (() => Date.now());
    this.roundId = asRoundId(`${options.tableId}-round-0`);
  }

  /** Chips a seat currently has free to bet or cash out. */
  getStack(seatId: SeatId): number {
    return this.ledger.getStack(seatId);
  }

  /** The full event log so far, in order. */
  getEvents(): readonly TableEvent[] {
    return this.events;
  }

  /**
   * Submit an intent. The returned event records whether it was accepted; a
   * rejected intent leaves all state untouched apart from the appended event.
   */
  submitIntent(intent: TableIntent): TableEvent {
    const decision = this.evaluate(intent);
    return this.record(intent, decision);
  }

  /**
   * Decide an intent without mutating the log. On acceptance this performs the
   * state change and returns the phase (plus any revealed cards / outcome); on
   * rejection it returns a reason and changes nothing.
   */
  private evaluate(intent: TableIntent): EvaluationResult {
    switch (intent.type) {
      case "buy_in":
        return this.evaluateBuyIn(intent.actorId, intent.seatId, intent.amount);
      case "start_round":
        return this.evaluateStartRound(intent.actorId);
      case "place_bet":
        return this.evaluatePlaceBet(
          intent.actorId,
          intent.seatId,
          intent.betKind,
          intent.amount,
        );
      case "clear_bets":
        return this.evaluateClearBets(intent.actorId, intent.seatId);
      case "no_more_bets":
        return this.evaluateNoMoreBets(intent.actorId);
      case "deal_next":
        return this.evaluateDealNext(intent.actorId);
      case "settle_round":
        return this.evaluateSettleRound(intent.actorId);
      case "cash_out":
        return this.evaluateCashOut(intent.actorId, intent.seatId);
      case "reveal":
        // Reveal is reserved for the squeeze flow; accepted as a no-op for now.
        return { accepted: true };
      default:
        return { accepted: false, rejectReason: "unknown_intent" };
    }
  }

  private evaluateBuyIn(
    actorId: ActorId,
    seatId: SeatId,
    amount: number,
  ): EvaluationResult {
    if (this.phase !== "shoe_ready" && this.phase !== "round_end") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }
    if (!this.seatIds.includes(seatId)) {
      return { accepted: false, rejectReason: "no_such_seat" };
    }
    this.occupants.set(seatId, actorId);
    this.ledger.buyIn(seatId, amount);
    return { accepted: true };
  }

  private evaluateStartRound(actorId: ActorId): EvaluationResult {
    if (actorId !== this.dealerId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    if (this.phase !== "shoe_ready" && this.phase !== "round_end") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }
    this.roundCounter += 1;
    this.roundId = asRoundId(`${this.tableId}-round-${this.roundCounter}`);
    this.playerCards = [];
    this.bankerCards = [];
    this.bets = [];
    this.outcome = null;
    this.phase = "round_betting";
    return { accepted: true };
  }

  private evaluatePlaceBet(
    actorId: ActorId,
    seatId: SeatId,
    betKind: BetKind,
    amount: number,
  ): EvaluationResult {
    if (this.phase !== "round_betting") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }
    if (!this.seatIds.includes(seatId)) {
      return { accepted: false, rejectReason: "no_such_seat" };
    }
    if (this.occupants.get(seatId) !== actorId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    if (amount < this.rulePack.limits.min) {
      return { accepted: false, rejectReason: "bet_below_minimum" };
    }
    if (amount > this.rulePack.limits.max) {
      return { accepted: false, rejectReason: "bet_above_maximum" };
    }
    if (!this.ledger.tryLockBet(seatId, amount)) {
      return { accepted: false, rejectReason: "insufficient_funds" };
    }
    this.bets.push({ seatId, betKind, amount });
    return { accepted: true };
  }

  private evaluateClearBets(
    actorId: ActorId,
    seatId: SeatId,
  ): EvaluationResult {
    if (this.phase !== "round_betting") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }
    if (this.occupants.get(seatId) !== actorId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    // Return each of this seat's locked bets to its stack, then drop them.
    const kept: PlacedBet[] = [];
    for (const bet of this.bets) {
      if (bet.seatId === seatId) {
        this.ledger.applyPayout(seatId, bet.amount);
      } else {
        kept.push(bet);
      }
    }
    this.bets = kept;
    return { accepted: true };
  }

  private evaluateNoMoreBets(actorId: ActorId): EvaluationResult {
    if (actorId !== this.dealerId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    if (this.phase !== "round_betting") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }
    this.phase = "no_more_bets";
    return { accepted: true };
  }

  private evaluateDealNext(actorId: ActorId): EvaluationResult {
    if (actorId !== this.dealerId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    if (this.phase !== "no_more_bets" && this.phase !== "dealing") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }

    // The first deal advances out of no_more_bets into the dealing phase.
    this.phase = "dealing";

    const target = this.nextDrawTarget();
    if (target === null) {
      // Nothing left to draw; the hand is complete.
      this.phase = "settling";
      return { accepted: true, cardsRevealed: [] };
    }

    const card = this.drawCard();
    if (target === "player") {
      this.playerCards.push(card);
    } else {
      this.bankerCards.push(card);
    }

    if (this.nextDrawTarget() === null) {
      this.phase = "settling";
    }

    // Peeking is not implemented yet, so a dealt card is revealed immediately.
    return { accepted: true, cardsRevealed: [card] };
  }

  private evaluateSettleRound(actorId: ActorId): EvaluationResult {
    if (actorId !== this.dealerId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    if (this.phase !== "settling") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }

    const outcome = this.determineOutcome();
    this.outcome = outcome;
    this.applyPayouts(outcome);
    this.phase = "round_end";
    return { accepted: true, outcome };
  }

  private evaluateCashOut(
    actorId: ActorId,
    seatId: SeatId,
  ): EvaluationResult {
    if (this.occupants.get(seatId) !== actorId) {
      return { accepted: false, rejectReason: "not_authorised" };
    }
    if (this.phase !== "shoe_ready" && this.phase !== "round_end") {
      return { accepted: false, rejectReason: "wrong_phase" };
    }
    this.ledger.cashOut(seatId);
    return { accepted: true };
  }

  /**
   * The next hand to receive a card, or null when the hand is complete.
   *
   * This encodes the deal order and the third-card rules together: the first
   * four cards alternate player/banker, then naturals end the hand, then the
   * player may draw, then the banker's draw depends on the player's third card.
   */
  private nextDrawTarget(): "player" | "banker" | null {
    const player = this.playerCards;
    const banker = this.bankerCards;

    // Initial deal: P, B, P, B.
    if (player.length === 0) return "player";
    if (banker.length === 0) return "banker";
    if (player.length === 1) return "player";
    if (banker.length === 1) return "banker";

    const playerTotal = baccaratHandTotal(player);
    const bankerTotal = baccaratHandTotal(banker);

    // A natural on either side ends the hand with no third card.
    if (isNatural(playerTotal) || isNatural(bankerTotal)) {
      return null;
    }

    // Player acts first.
    if (player.length === 2) {
      if (playerDrawsThird(playerTotal)) {
        return "player";
      }
      // Player stood; banker plays the player rule (third value is null).
      if (banker.length === 2 && bankerDrawsThird(bankerTotal, null)) {
        return "banker";
      }
      return null;
    }

    // Player drew a third card; the banker's action depends on its value.
    if (banker.length === 2) {
      const playerThirdCard = player[2];
      if (playerThirdCard === undefined) {
        return null;
      }
      const playerThirdValue = baccaratCardValue(playerThirdCard);
      if (bankerDrawsThird(bankerTotal, playerThirdValue)) {
        return "banker";
      }
    }
    return null;
  }

  private determineOutcome(): RoundOutcome {
    const playerTotal = baccaratHandTotal(this.playerCards);
    const bankerTotal = baccaratHandTotal(this.bankerCards);
    if (playerTotal > bankerTotal) return "player";
    if (bankerTotal > playerTotal) return "banker";
    return "tie";
  }

  /** Settle every bet into the ledger, aggregating per seat. */
  private applyPayouts(outcome: RoundOutcome): void {
    const bankerTotal = baccaratHandTotal(this.bankerCards);
    const playerPair = isFirstPair(this.playerCards);
    const bankerPair = isFirstPair(this.bankerCards);

    // Sum payouts per seat so each seat's locked amount is cleared exactly once.
    const payoutBySeat = new Map<SeatId, number>();
    for (const bet of this.bets) {
      const payout = this.payoutForBet(bet, outcome, bankerTotal, playerPair, bankerPair);
      payoutBySeat.set(bet.seatId, (payoutBySeat.get(bet.seatId) ?? 0) + payout);
    }
    for (const [seatId, payout] of payoutBySeat) {
      this.ledger.applyPayout(seatId, payout);
    }
  }

  private payoutForBet(
    bet: PlacedBet,
    outcome: RoundOutcome,
    bankerTotal: number,
    playerPair: boolean,
    bankerPair: boolean,
  ): number {
    if (isMainBet(bet.betKind)) {
      return computeMainBetPayout(
        bet.betKind,
        bet.amount,
        outcome,
        this.rulePack,
        bankerTotal,
      ).payout;
    }
    const isPair = bet.betKind === "player_pair" ? playerPair : bankerPair;
    return computeSideBetPayout(bet.betKind, bet.amount, isPair, this.rulePack).payout;
  }

  /** Append an event for a decided intent and return it. */
  private record(intent: TableIntent, decision: EvaluationResult): TableEvent {
    this.seq += 1;
    const event: TableEvent = {
      tableId: this.tableId,
      roundId: this.roundId,
      seq: this.seq,
      actorId: intent.actorId,
      intent,
      accepted: decision.accepted,
      ...(decision.rejectReason !== undefined
        ? { rejectReason: decision.rejectReason }
        : {}),
      phaseAfter: this.phase,
      ...(decision.cardsRevealed !== undefined
        ? { cardsRevealed: decision.cardsRevealed }
        : {}),
      ...(decision.outcome !== undefined ? { outcome: decision.outcome } : {}),
      rulePackId: this.rulePack.id,
      rulePackVersion: this.rulePack.version,
      at: this.now(),
    };
    this.events.push(event);
    return event;
  }

  /** A denormalised view of the current table state. */
  getSnapshot(): TableSnapshot {
    return {
      tableId: this.tableId,
      roundId: this.roundId,
      phase: this.phase,
      seats: this.seatIds.map((seatId) => ({
        seatId,
        occupantId: this.occupants.get(seatId) ?? null,
        stack: this.ledger.getStack(seatId),
      })),
      bets: this.bets.map((bet) => ({
        seatId: bet.seatId,
        betKind: bet.betKind,
        amount: bet.amount,
      })),
      hands: {
        player: [...this.playerCards],
        banker: [...this.bankerCards],
        playerTotal: baccaratHandTotal(this.playerCards),
        bankerTotal: baccaratHandTotal(this.bankerCards),
      },
      outcome: this.outcome,
      rulePackId: this.rulePack.id,
      rulePackVersion: this.rulePack.version,
      lastEventSeq: this.seq,
    };
  }
}

/** Whether a hand's first two cards share a rank (a pair for side bets). */
function isFirstPair(cards: readonly Card[]): boolean {
  const first = cards[0];
  const second = cards[1];
  return first !== undefined && second !== undefined && first.rank === second.rank;
}

/** Internal result of deciding an intent, before it is logged. */
interface EvaluationResult {
  readonly accepted: boolean;
  readonly rejectReason?: RejectReason;
  readonly cardsRevealed?: readonly Card[];
  readonly outcome?: RoundOutcome;
}
