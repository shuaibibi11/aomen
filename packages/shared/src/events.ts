/**
 * Table phases and the event stream.
 *
 * The TableRuntime is a state machine; TablePhase names the states. Every
 * accepted or rejected intent, plus each settlement, is appended to an event
 * log as a TableEvent. The log is the source of truth for replay, so its shape
 * is fixed and every field is explicit.
 *
 * Event field contract (design spec §4.6):
 *   tableId, roundId, seq, actorId, intent?, accepted?, rejectReason?,
 *   phaseAfter, visibleMask?, rulePackId, rulePackVersion, at
 *
 * Intent-carrying events must set `intent` and `accepted`. Settlement and
 * lifecycle events may omit `intent` but always record `phaseAfter`.
 */
import type { RoundOutcome } from "./bets.js";
import type { Card } from "./cards.js";
import type { ActorId, RoundId, TableId } from "./ids.js";
import type { TableIntent } from "./intents.js";

export type TablePhase =
  | "shoe_ready"
  | "round_betting"
  | "no_more_bets"
  | "dealing"
  | "settling"
  | "round_end";

/** Why an intent was rejected, for the trainee and for the log. */
export type RejectReason =
  | "wrong_phase"
  | "not_authorised"
  | "bet_below_minimum"
  | "bet_above_maximum"
  | "insufficient_funds"
  | "no_such_seat"
  | "unknown_bet_kind"
  | "bet_not_available"
  | "invalid_bet_amount"
  | "unknown_intent";

/**
 * One record in the append-only table log.
 *
 * `seq` is a per-table monotonic counter so a replay can order events without
 * relying on timestamps. `visibleMask` lists the actor ids allowed to see this
 * event's detail, for hands dealt face-down during a squeeze; an empty or
 * absent mask means public.
 */
export interface TableEvent {
  readonly tableId: TableId;
  readonly roundId: RoundId;
  readonly seq: number;
  readonly actorId: ActorId;
  /** The intent that produced this event, for intent-driven events. */
  readonly intent?: TableIntent;
  /** Whether the intent was accepted. Present on intent-driven events. */
  readonly accepted?: boolean;
  readonly rejectReason?: RejectReason;
  /** Phase after this event was applied. */
  readonly phaseAfter: TablePhase;
  /** Cards revealed by this event, if any. */
  readonly cardsRevealed?: readonly Card[];
  /** Outcome recorded by a settlement event. */
  readonly outcome?: RoundOutcome;
  /** Actor ids allowed to see private detail; absent means public. */
  readonly visibleMask?: readonly ActorId[];
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  /** Wall-clock time the event was recorded, epoch milliseconds. */
  readonly at: number;
}
