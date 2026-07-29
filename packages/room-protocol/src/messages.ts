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
import {
  BET_KINDS,
  RANKS,
  SUITS,
  asActorId,
  asRoundId,
  asSeatId,
  asTableId,
} from "@mct/shared";

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
  "room_unavailable",
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

/** Raised when an untrusted server value does not satisfy the wire contract. */
export class ServerMessageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerMessageParseError";
  }
}

const tablePhaseSet: ReadonlySet<unknown> = new Set([
  "shoe_ready",
  "round_betting",
  "no_more_bets",
  "dealing",
  "settling",
  "round_end",
]);
const rankSet: ReadonlySet<unknown> = new Set(RANKS);
const suitSet: ReadonlySet<unknown> = new Set(SUITS);
const roundOutcomeSet: ReadonlySet<unknown> = new Set(["player", "banker", "tie"]);
const rejectReasonSet: ReadonlySet<unknown> = new Set([
  "wrong_phase",
  "not_authorised",
  "bet_below_minimum",
  "bet_above_maximum",
  "insufficient_funds",
  "no_such_seat",
  "unknown_bet_kind",
  "unknown_intent",
]);

function requireServerObject(value: unknown, fieldName: string): UntrustedObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServerMessageParseError(`${fieldName} must be an object`);
  }
  return value as UntrustedObject;
}

function requireServerString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ServerMessageParseError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ServerMessageParseError(`${fieldName} must be a finite number`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, fieldName: string): number {
  const numberValue = requireFiniteNumber(value, fieldName);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new ServerMessageParseError(`${fieldName} must be a non-negative integer`);
  }
  return numberValue;
}

function requireArray(value: unknown, fieldName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ServerMessageParseError(`${fieldName} must be an array`);
  }
  return value;
}

function validateCard(value: unknown, fieldName: string): void {
  const card = requireServerObject(value, fieldName);
  if (!rankSet.has(card.rank) || !suitSet.has(card.suit)) {
    throw new ServerMessageParseError(`${fieldName} must contain a supported rank and suit`);
  }
}

function parseTableSnapshot(value: unknown, fieldName: string): TableSnapshot {
  const snapshot = requireServerObject(value, fieldName);
  asTableId(requireServerString(snapshot.tableId, `${fieldName}.tableId`));
  asRoundId(requireServerString(snapshot.roundId, `${fieldName}.roundId`));
  if (!tablePhaseSet.has(snapshot.phase)) {
    throw new ServerMessageParseError(`${fieldName}.phase is not supported`);
  }

  for (const [seatIndex, seatValue] of requireArray(snapshot.seats, `${fieldName}.seats`).entries()) {
    const seat = requireServerObject(seatValue, `${fieldName}.seats[${seatIndex}]`);
    asSeatId(requireServerString(seat.seatId, `${fieldName}.seats[${seatIndex}].seatId`));
    if (seat.occupantId !== null) {
      asActorId(requireServerString(seat.occupantId, `${fieldName}.seats[${seatIndex}].occupantId`));
    }
    requireFiniteNumber(seat.stack, `${fieldName}.seats[${seatIndex}].stack`);
  }

  for (const [betIndex, betValue] of requireArray(snapshot.bets, `${fieldName}.bets`).entries()) {
    const bet = requireServerObject(betValue, `${fieldName}.bets[${betIndex}]`);
    asSeatId(requireServerString(bet.seatId, `${fieldName}.bets[${betIndex}].seatId`));
    if (!betKindSet.has(bet.betKind)) {
      throw new ServerMessageParseError(`${fieldName}.bets[${betIndex}].betKind is not supported`);
    }
    requireFiniteNumber(bet.amount, `${fieldName}.bets[${betIndex}].amount`);
  }

  const hands = requireServerObject(snapshot.hands, `${fieldName}.hands`);
  for (const [cardIndex, card] of requireArray(hands.player, `${fieldName}.hands.player`).entries()) {
    validateCard(card, `${fieldName}.hands.player[${cardIndex}]`);
  }
  for (const [cardIndex, card] of requireArray(hands.banker, `${fieldName}.hands.banker`).entries()) {
    validateCard(card, `${fieldName}.hands.banker[${cardIndex}]`);
  }
  requireFiniteNumber(hands.playerTotal, `${fieldName}.hands.playerTotal`);
  requireFiniteNumber(hands.bankerTotal, `${fieldName}.hands.bankerTotal`);

  if (snapshot.outcome !== null && !roundOutcomeSet.has(snapshot.outcome)) {
    throw new ServerMessageParseError(`${fieldName}.outcome is not supported`);
  }
  requireServerString(snapshot.rulePackId, `${fieldName}.rulePackId`);
  requireServerString(snapshot.rulePackVersion, `${fieldName}.rulePackVersion`);
  requireNonNegativeInteger(snapshot.lastEventSeq, `${fieldName}.lastEventSeq`);
  return snapshot as unknown as TableSnapshot;
}

function parseTableEvent(value: unknown): TableEvent {
  const event = requireServerObject(value, "message.event");
  asTableId(requireServerString(event.tableId, "message.event.tableId"));
  asRoundId(requireServerString(event.roundId, "message.event.roundId"));
  requireNonNegativeInteger(event.seq, "message.event.seq");
  asActorId(requireServerString(event.actorId, "message.event.actorId"));
  if (!tablePhaseSet.has(event.phaseAfter)) {
    throw new ServerMessageParseError("message.event.phaseAfter is not supported");
  }
  if ("intent" in event) {
    try {
      parseTableIntent(event.intent);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "intent is invalid";
      throw new ServerMessageParseError(`message.event.${detail}`);
    }
  }
  if ("accepted" in event && typeof event.accepted !== "boolean") {
    throw new ServerMessageParseError("message.event.accepted must be a boolean");
  }
  if ("rejectReason" in event && !rejectReasonSet.has(event.rejectReason)) {
    throw new ServerMessageParseError("message.event.rejectReason is not supported");
  }
  if ("cardsRevealed" in event) {
    for (const [cardIndex, card] of requireArray(
      event.cardsRevealed,
      "message.event.cardsRevealed",
    ).entries()) {
      validateCard(card, `message.event.cardsRevealed[${cardIndex}]`);
    }
  }
  if ("outcome" in event && !roundOutcomeSet.has(event.outcome)) {
    throw new ServerMessageParseError("message.event.outcome is not supported");
  }
  if ("visibleMask" in event) {
    for (const [actorIndex, actorId] of requireArray(
      event.visibleMask,
      "message.event.visibleMask",
    ).entries()) {
      asActorId(requireServerString(
        actorId,
        `message.event.visibleMask[${actorIndex}]`,
      ));
    }
  }
  requireServerString(event.rulePackId, "message.event.rulePackId");
  requireServerString(event.rulePackVersion, "message.event.rulePackVersion");
  requireNonNegativeInteger(event.at, "message.event.at");
  return event as unknown as TableEvent;
}

/**
 * Parse one untrusted server wire value. Required fields are validated while
 * unknown fields are retained so additive protocol changes remain compatible.
 */
export function parseServerMessage(value: unknown): ServerMessage {
  const message = requireServerObject(value, "message");
  const type = requireServerString(message.type, "message.type");

  switch (type) {
    case "joined":
      return {
        ...message,
        type,
        tableId: asTableId(requireServerString(message.tableId, "message.tableId")),
        actorId: asActorId(requireServerString(message.actorId, "message.actorId")),
        protocolVersion: requireNonNegativeInteger(message.protocolVersion, "message.protocolVersion"),
        snapshot: parseTableSnapshot(message.snapshot, "message.snapshot"),
      } as JoinedMessage;
    case "snapshot":
      return {
        ...message,
        type,
        snapshot: parseTableSnapshot(message.snapshot, "message.snapshot"),
      } as SnapshotMessage;
    case "event":
      return { ...message, type, event: parseTableEvent(message.event) } as EventMessage;
    case "error":
      if (!isRoomErrorCode(message.code)) {
        throw new ServerMessageParseError("message.code is not supported");
      }
      return {
        ...message,
        type,
        code: message.code,
        message: requireServerString(message.message, "message.message"),
      } as ErrorMessage;
    case "pong":
      return {
        ...message,
        type,
        nonce: requireFiniteNumber(message.nonce, "message.nonce"),
      } as PongMessage;
    default:
      throw new ServerMessageParseError("message.type is not supported");
  }
}
