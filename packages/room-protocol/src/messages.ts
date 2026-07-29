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
import { BET_KINDS, asActorId, asSeatId, asTableId } from "@mct/shared";

/** Protocol version, bumped when a breaking change lands on the wire. */
export const ROOM_PROTOCOL_VERSION = 2;

// --- Client → Server ---------------------------------------------------------

/** Ask to join a room as a given actor. */
export interface JoinRoomMessage {
  readonly type: "join_room";
  readonly tableId: TableId;
  readonly actorId: ActorId;
  readonly credential: string;
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

/** Raised when an untrusted client value does not satisfy the wire contract. */
export class ClientMessageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientMessageParseError";
  }
}

type UntrustedObject = Record<string, unknown>;

const betKindSet: ReadonlySet<unknown> = new Set(BET_KINDS);

function requireObject(value: unknown, fieldName: string): UntrustedObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClientMessageParseError(`${fieldName} must be an object`);
  }
  return value as UntrustedObject;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ClientMessageParseError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function requirePositiveAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ClientMessageParseError(
      "intent.amount must be a finite positive number",
    );
  }
  return value;
}

function parseTableIntent(value: unknown): TableIntent {
  const intent = requireObject(value, "intent");
  const type = requireNonEmptyString(intent.type, "intent.type");
  const actorId = asActorId(
    requireNonEmptyString(intent.actorId, "intent.actorId"),
  );

  switch (type) {
    case "buy_in":
      return {
        ...intent,
        type,
        actorId,
        seatId: asSeatId(
          requireNonEmptyString(intent.seatId, "intent.seatId"),
        ),
        amount: requirePositiveAmount(intent.amount),
      } as TableIntent;
    case "place_bet": {
      if (!betKindSet.has(intent.betKind)) {
        throw new ClientMessageParseError("intent.betKind is not supported");
      }
      return {
        ...intent,
        type,
        actorId,
        seatId: asSeatId(
          requireNonEmptyString(intent.seatId, "intent.seatId"),
        ),
        betKind: intent.betKind,
        amount: requirePositiveAmount(intent.amount),
      } as TableIntent;
    }
    case "clear_bets":
    case "cash_out":
      return {
        ...intent,
        type,
        actorId,
        seatId: asSeatId(
          requireNonEmptyString(intent.seatId, "intent.seatId"),
        ),
      } as TableIntent;
    case "start_round":
    case "no_more_bets":
    case "deal_next":
    case "reveal":
    case "settle_round":
      return { ...intent, type, actorId } as TableIntent;
    default:
      throw new ClientMessageParseError("intent.type is not supported");
  }
}

/**
 * Parse one untrusted wire value. Unknown fields are retained for forward
 * compatibility, while every currently required field is validated strictly.
 */
export function parseClientMessage(value: unknown): ClientMessage {
  const message = requireObject(value, "message");
  const type = requireNonEmptyString(message.type, "message.type");

  switch (type) {
    case "join_room":
      return {
        ...message,
        type,
        tableId: asTableId(
          requireNonEmptyString(message.tableId, "message.tableId"),
        ),
        actorId: asActorId(
          requireNonEmptyString(message.actorId, "message.actorId"),
        ),
        credential: requireNonEmptyString(
          message.credential,
          "message.credential",
        ),
      } as JoinRoomMessage;
    case "submit_intent":
      return {
        ...message,
        type,
        intent: parseTableIntent(message.intent),
      } as SubmitIntentMessage;
    case "ping":
      if (typeof message.nonce !== "number" || !Number.isFinite(message.nonce)) {
        throw new ClientMessageParseError("message.nonce must be a finite number");
      }
      return { ...message, type, nonce: message.nonce } as PingMessage;
    default:
      throw new ClientMessageParseError("message.type is not supported");
  }
}

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

/** Runtime-checkable error codes the server can report to a client. */
export const ROOM_ERROR_CODES = [
  "unknown_room",
  "not_joined",
  "actor_not_allowed",
  "actor_mismatch",
  "intent_not_allowed",
  "malformed_message",
  "internal_error",
] as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

const roomErrorCodeSet: ReadonlySet<unknown> = new Set(ROOM_ERROR_CODES);

/** Narrow an untrusted wire value to a supported room error code. */
export function isRoomErrorCode(value: unknown): value is RoomErrorCode {
  return roomErrorCodeSet.has(value);
}
