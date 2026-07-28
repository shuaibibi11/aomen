/**
 * Branded identifier types.
 *
 * These are string ids at runtime, but each is tagged with a unique brand at
 * the type level so a TableId cannot be passed where a RoundId is expected. The
 * `asXxx` helpers are the only sanctioned way to construct one, which keeps the
 * casts in a single audited place.
 */

declare const brand: unique symbol;

/** A string tagged with a compile-time-only brand. */
type Branded<TBrand extends string> = string & { readonly [brand]: TBrand };

export type TableId = Branded<"TableId">;
export type RoundId = Branded<"RoundId">;
export type SeatId = Branded<"SeatId">;
export type ActorId = Branded<"ActorId">;

export function asTableId(value: string): TableId {
  return value as TableId;
}

export function asRoundId(value: string): RoundId {
  return value as RoundId;
}

export function asSeatId(value: string): SeatId {
  return value as SeatId;
}

export function asActorId(value: string): ActorId {
  return value as ActorId;
}

/**
 * The system actor used when no human dealer is present: the server drives the
 * deal/settle steps under this id. Distinguishing it from a human dealer keeps
 * the event log honest about who acted.
 */
export const SYSTEM_DEALER: ActorId = asActorId("system:dealer");
