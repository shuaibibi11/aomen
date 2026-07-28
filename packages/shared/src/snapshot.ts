/**
 * Table snapshot: the full readable state of a table at one moment.
 *
 * The event log is the source of truth; a snapshot is a derived, denormalised
 * view the server broadcasts so clients do not have to replay events. It is
 * plain data — no methods — so it serialises cleanly over the wire.
 */
import type { BetKind, RoundOutcome } from "./bets.js";
import type { Card } from "./cards.js";
import type { ActorId, RoundId, SeatId, TableId } from "./ids.js";
import type { TablePhase } from "./events.js";

/** One placed bet, as seen in a snapshot. */
export interface SnapshotBet {
  readonly seatId: SeatId;
  readonly betKind: BetKind;
  readonly amount: number;
}

/** A seat's occupancy and current chip stack. */
export interface SnapshotSeat {
  readonly seatId: SeatId;
  readonly occupantId: ActorId | null;
  readonly stack: number;
}

/**
 * The two baccarat hands. Cards are listed in deal order. During a squeeze a
 * hand may be present but not yet revealed to the public snapshot.
 */
export interface SnapshotHands {
  readonly player: readonly Card[];
  readonly banker: readonly Card[];
  readonly playerTotal: number;
  readonly bankerTotal: number;
}

export interface TableSnapshot {
  readonly tableId: TableId;
  readonly roundId: RoundId;
  readonly phase: TablePhase;
  readonly seats: readonly SnapshotSeat[];
  readonly bets: readonly SnapshotBet[];
  readonly hands: SnapshotHands;
  /** Present once the round has settled. */
  readonly outcome: RoundOutcome | null;
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  /** Sequence number of the last event folded into this snapshot. */
  readonly lastEventSeq: number;
}
