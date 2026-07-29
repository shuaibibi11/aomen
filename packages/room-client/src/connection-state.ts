export type RoomConnectionState =
  | "idle"
  | "connecting"
  | "joining"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "closed";

export interface RoomConnectionStateSnapshot {
  readonly state: RoomConnectionState;
  readonly lastMessageAt: number | null;
  readonly lastPongAt: number | null;
  readonly reconnectAttempt: number;
  readonly lastError: Error | null;
}

export type RoomConnectionStateListener = (
  snapshot: RoomConnectionStateSnapshot,
) => void;

export type Unsubscribe = () => void;
