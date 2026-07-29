import type {
  ActorId,
  BetKind,
  SeatId,
  TableEvent,
  TableSnapshot,
} from "@mct/shared";
import type { RulePack } from "@mct/rule-packs/schema";
import type { RoomSessionCapabilities } from "@mct/room-protocol";
import type { BetSpotSpec, TableVariant } from "../specs/table-layout.js";

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

export interface TableSessionUpdate {
  readonly event?: TableEvent;
  readonly snapshot: TableSnapshot;
}

export type TableSessionListener = (update: TableSessionUpdate) => void;
export type TableSessionUnsubscribe = () => void;

export interface TableSession {
  getCapabilities(): RoomSessionCapabilities;
  getRulePack(): RulePack;
  getBetSpots(): readonly BetSpotSpec[];
  getSeats(): readonly SessionSeat[];
  getGuestSeat(): SessionSeat;
  getSnapshot(): TableSnapshot;
  getEvents(): readonly TableEvent[];
  getStack(seatLabel: number): number;
  getBetAmount(seatLabel: number, betKind: BetKind): number;
  placeBet(seatLabel: number, betKind: BetKind, amount: number): Promise<TableEvent>;
  clearBets(seatLabel: number): Promise<TableEvent>;
  closeBetting(): Promise<TableEvent>;
  dealNext(): Promise<TableEvent>;
  settleRound(): Promise<TableEvent>;
  startRound(): Promise<TableEvent>;
  subscribe(listener: TableSessionListener): TableSessionUnsubscribe;
  dispose(): void;
}

export type TableSessionFactory = (
  options: TableSessionOptions,
) => Promise<TableSession>;

export interface TableSessionNotifier {
  subscribe(listener: TableSessionListener): TableSessionUnsubscribe;
  publish(event: TableEvent): void;
  publishSnapshot(snapshot: TableSnapshot): void;
  dispose(): void;
}

export function createTableSessionNotifier(
  getSnapshot: () => TableSnapshot,
): TableSessionNotifier {
  const listeners = new Set<TableSessionListener>();
  let lastPublishedSequence = -1;
  let disposed = false;

  return {
    subscribe(listener) {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event) {
      if (disposed) {
        return;
      }
      const snapshot = getSnapshot();
      if (snapshot.lastEventSeq <= lastPublishedSequence) {
        return;
      }
      if (event.seq !== snapshot.lastEventSeq) {
        throw new Error(
          `Table session update sequence mismatch: event ${event.seq}, snapshot ${snapshot.lastEventSeq}`,
        );
      }
      lastPublishedSequence = snapshot.lastEventSeq;
      const update = { event, snapshot };
      for (const listener of listeners) {
        listener(update);
      }
    },
    publishSnapshot(snapshot) {
      if (disposed || snapshot.lastEventSeq <= lastPublishedSequence) {
        return;
      }
      lastPublishedSequence = snapshot.lastEventSeq;
      for (const listener of listeners) {
        listener({ snapshot });
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
