import { describe, expect, it } from "vitest";
import {
  ClientMessageParseError,
  ROOM_ERROR_CODES,
  ROOM_PROTOCOL_VERSION,
  isRoomErrorCode,
  parseClientMessage,
} from "./messages.js";

describe("client message parsing", () => {
  it("parses every supported client message and table intent", () => {
    const validMessages = [
      { type: "join_room", tableId: "table-1", actorId: "human-1", credential: "room-secret" },
      { type: "ping", nonce: 42 },
      { type: "submit_intent", intent: { type: "buy_in", actorId: "human-1", seatId: "seat-1", amount: 100 } },
      { type: "submit_intent", intent: { type: "start_round", actorId: "human-1" } },
      { type: "submit_intent", intent: { type: "place_bet", actorId: "human-1", seatId: "seat-1", betKind: "player", amount: 100 } },
      { type: "submit_intent", intent: { type: "clear_bets", actorId: "human-1", seatId: "seat-1" } },
      { type: "submit_intent", intent: { type: "no_more_bets", actorId: "human-1" } },
      { type: "submit_intent", intent: { type: "deal_next", actorId: "human-1" } },
      { type: "submit_intent", intent: { type: "reveal", actorId: "human-1" } },
      { type: "submit_intent", intent: { type: "settle_round", actorId: "human-1" } },
      { type: "submit_intent", intent: { type: "cash_out", actorId: "human-1", seatId: "seat-1" } },
    ];

    for (const message of validMessages) {
      expect(parseClientMessage(message)).toEqual(message);
    }
  });

  it.each([
    null,
    [],
    {},
    { type: "unknown" },
    { type: "join_room", tableId: "", actorId: "human-1", credential: "room-secret" },
    { type: "join_room", tableId: "table-1", actorId: "", credential: "room-secret" },
    { type: "join_room", tableId: "table-1", actorId: "human-1", credential: "" },
    { type: "ping", nonce: Number.NaN },
    { type: "ping", nonce: "42" },
    { type: "submit_intent" },
    { type: "submit_intent", intent: { type: "place_bet", actorId: "human-1", seatId: "seat-1", betKind: "dragon", amount: 100 } },
    { type: "submit_intent", intent: { type: "place_bet", actorId: "human-1", seatId: "seat-1", betKind: "player", amount: 0 } },
    { type: "submit_intent", intent: { type: "place_bet", actorId: "human-1", seatId: "seat-1", betKind: "player", amount: Number.POSITIVE_INFINITY } },
  ])("rejects malformed client value %#", (value) => {
    expect(() => parseClientMessage(value)).toThrow(ClientMessageParseError);
  });

  it("allows unknown fields while strictly validating required fields", () => {
    expect(parseClientMessage({ type: "ping", nonce: 1, futureField: true })).toEqual({
      type: "ping",
      nonce: 1,
      futureField: true,
    });
  });

  it("uses protocol version 2 for credential-authenticated joins", () => {
    expect(ROOM_PROTOCOL_VERSION).toBe(2);
  });
});

describe("room protocol error codes", () => {
  it("exports the complete runtime-checkable error code set", () => {
    expect(ROOM_ERROR_CODES).toEqual([
      "unknown_room",
      "room_unavailable",
      "not_joined",
      "actor_not_allowed",
      "actor_mismatch",
      "intent_not_allowed",
      "malformed_message",
      "internal_error",
    ]);
  });

  it("recognizes protocol error codes at runtime", () => {
    expect(isRoomErrorCode("room_unavailable")).toBe(true);
    expect(isRoomErrorCode("intent_not_allowed")).toBe(true);
    expect(isRoomErrorCode("internal_error")).toBe(true);
    expect(isRoomErrorCode("database_exploded")).toBe(false);
    expect(isRoomErrorCode(null)).toBe(false);
  });
});
