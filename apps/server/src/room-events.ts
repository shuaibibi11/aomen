import type { TableEvent, TableSnapshot } from "@mct/shared";

/** One authoritative state transition published after durable append. */
export interface RoomUpdate {
  readonly event: TableEvent;
  readonly snapshot: TableSnapshot;
}

/** Receives authoritative updates for one room. */
export type RoomUpdateListener = (update: RoomUpdate) => void;

/** Stops a previously registered room update subscription. */
export type UnsubscribeRoomUpdates = () => void;
