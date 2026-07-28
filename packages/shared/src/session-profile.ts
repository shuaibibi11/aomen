/**
 * Session profile: how one training session is configured.
 *
 * A session pins the rule pack, the pedagogy level (L1–L3), the realism level
 * (R1–R3), the AI roster filling empty seats, and the shoe seed so a session
 * can be reproduced or replayed exactly.
 */
import type { ActorId, SeatId, TableId } from "./ids.js";

/** Pedagogy level: how much guidance the trainee gets. */
export type PedagogyLevel = "L1" | "L2" | "L3";

/** Realism level: how close to a live floor the presentation is. */
export type RealismLevel = "R1" | "R2" | "R3";

/** One AI-controlled seat occupant. */
export interface AiSeat {
  readonly seatId: SeatId;
  readonly actorId: ActorId;
  /** Named behaviour profile, resolved by the AI layer. */
  readonly persona: string;
}

export interface SessionProfile {
  readonly tableId: TableId;
  readonly rulePackId: string;
  readonly rulePackVersion: string;
  readonly pedagogyLevel: PedagogyLevel;
  readonly realismLevel: RealismLevel;
  /** AI occupants seated when the session starts. */
  readonly aiRoster: readonly AiSeat[];
  /** Seed for the shoe RNG, so a session's card order is reproducible. */
  readonly shoeSeed: string;
}
