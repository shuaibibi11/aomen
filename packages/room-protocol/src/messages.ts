/**
 * WebSocket message contracts between a client and the room server.
 *
 * These are the only shapes that cross the wire. A client sends intents and
 * housekeeping requests; the server replies with acknowledgements, snapshots,
 * events and errors. Every message carries a `type` discriminator so a receiver
 * can narrow it without guessing.
 *
 * The contracts reference the shared domain types directly so the client and
 * server can never disagree about what an intent or a snapshot looks like.
 */
import type {
  ActorId,
  TableEvent,
  TableId,
  TableIntent,
  TableSnapshot,
} from "@mct/shared";

/** Protocol version, bumped when a breaking change lands on the wire. */
export const ROOM_PROTOCOL_VERSION = 1;

// --- Client → Server ---------------------------------------------------------

/** Ask to join a room as a given actor. */
export interface JoinRoomMessage {
  readonly type: "join_room";
  readonly tableId: TableId;
  readonly actorId: ActorId;
}

/** Submit a table intent for the server to apply. */
export interface SubmitIntentMessage {
  readonly type: "submit_intent";
  readonly intent: TableIntent;
}

/** Liveness ping; the server replies with a pong echoing the nonce. */
export interface PingMessage {
  readonly type: "ping";
  readonly nonce: number;
}

/** Every message a client may send. */
export type ClientMessage =
  | JoinRoomMessage
  | SubmitIntentMessage
  | PingMessage;

export type ClientMessageType = ClientMessage["type"];

// --- Server → Client ---------------------------------------------------------

/** Confirms a join and hands over the current snapshot. */
export interface JoinedMessage {
  readonly type: "joined";
  readonly tableId: TableId;
  readonly actorId: ActorId;
  readonly protocolVersion: number;
  readonly snapshot: TableSnapshot;
}

/** A full table snapshot, broadcast after state changes. */
export interface SnapshotMessage {
  readonly type: "snapshot";
  readonly snapshot: TableSnapshot;
}

/** One appended table event, broadcast as it happens. */
export interface EventMessage {
  readonly type: "event";
  readonly event: TableEvent;
}

/** An error the server wants the client to surface. */
export interface ErrorMessage {
  readonly type: "error";
  readonly code: RoomErrorCode;
  readonly message: string;
}

/** Reply to a ping, echoing the client's nonce. */
export interface PongMessage {
  readonly type: "pong";
  readonly nonce: number;
}

/** Every message the server may send. */
export type ServerMessage =
  | JoinedMessage
  | SnapshotMessage
  | EventMessage
  | ErrorMessage
  | PongMessage;

export type ServerMessageType = ServerMessage["type"];

/** Error codes the server can report to a client. */
export type RoomErrorCode =
  | "unknown_room"
  | "not_joined"
  | "actor_not_allowed"
  | "actor_mismatch"
  | "malformed_message"
  | "internal_error";
