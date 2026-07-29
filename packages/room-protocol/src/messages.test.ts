import { describe, expect, it } from "vitest";
import {
  ClientMessageParseError,
  ROOM_ERROR_CODES,
  ROOM_PROTOCOL_VERSION,
  ServerMessageParseError,
  isRoomErrorCode,
  parseClientMessage,
  parseServerMessage,
} from "./messages.js";

const validSnapshot = {
  tableId: "table-1",
  roundId: "round-1",
  phase: "round_betting",
  seats: [{ seatId: "seat-1", occupantId: "human-1", stack: 1_000 }],
  bets: [{ seatId: "seat-1", betKind: "player", amount: 100 }],
  hands: {
    player: [],
    banker: [],
    playerTotal: 0,
    bankerTotal: 0,
  },
  outcome: null,
  rulePackId: "baccarat",
  rulePackVersion: "1.0.0",
  lastEventSeq: 1,
};

const validEvent = {
  tableId: "table-1",
  roundId: "round-1",
  seq: 1,
  actorId: "human-1",
  phaseAfter: "round_betting",
  rulePackId: "baccarat",
  rulePackVersion: "1.0.0",
  at: 100,
};

const validRulePack = {
  id: "baccarat",
  version: "1.0.0",
  displayName: "Baccarat",
  variant: "standard",
  limits: { min: 100, max: 100_000 },
  commission: { rate: 0.05 },
  mainPayouts: { player: 1, banker: 1, tie: 8 },
  sideBets: [{ kind: "player_pair", payout: 11 }],
  shoe: { deckCount: 8 },
  dealing: { peekAllowed: false },
  chipset: { currency: "HKD", denominations: [100, 500] },
};

const validSeats = [
  { seatId: "seat-1", label: 1, occupantId: "human-1" },
];
const validCapabilities = {
  canBet: true,
  canClearBets: true,
  canControlDealer: false,
};

describe("client message parsing", () => {
  it("parses every supported client message and table intent", () => {
    const validMessages = [
      { type: "join_room", tableId: "table-1", actorId: "human-1", credential: "room-secret" },
      { type: "ping", nonce: 42 },
      { type: "submit_intent", requestId: "request-1", intent: { type: "buy_in", actorId: "human-1", seatId: "seat-1", amount: 100 } },
      { type: "submit_intent", requestId: "request-2", intent: { type: "start_round", actorId: "human-1" } },
      { type: "submit_intent", requestId: "request-3", intent: { type: "place_bet", actorId: "human-1", seatId: "seat-1", betKind: "player", amount: 100 } },
      { type: "submit_intent", requestId: "request-4", intent: { type: "clear_bets", actorId: "human-1", seatId: "seat-1" } },
      { type: "submit_intent", requestId: "request-5", intent: { type: "no_more_bets", actorId: "human-1" } },
      { type: "submit_intent", requestId: "request-6", intent: { type: "deal_next", actorId: "human-1" } },
      { type: "submit_intent", requestId: "request-7", intent: { type: "reveal", actorId: "human-1" } },
      { type: "submit_intent", requestId: "request-8", intent: { type: "settle_round", actorId: "human-1" } },
      { type: "submit_intent", requestId: "request-9", intent: { type: "cash_out", actorId: "human-1", seatId: "seat-1" } },
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
    { type: "submit_intent", requestId: "", intent: { type: "start_round", actorId: "human-1" } },
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

  it("uses protocol version 3 for correlated authoritative sessions", () => {
    expect(ROOM_PROTOCOL_VERSION).toBe(3);
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
      "duplicate_request",
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

describe("server message parsing", () => {
  it.each([
    {
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot: validSnapshot,
      rulePack: validRulePack,
      seats: validSeats,
      capabilities: validCapabilities,
    },
    { type: "snapshot", snapshot: validSnapshot },
    { type: "event", event: validEvent },
    { type: "intent_result", requestId: "request-1", event: validEvent },
    { type: "error", code: "room_unavailable", message: "try later", requestId: "request-1" },
    { type: "pong", nonce: 7 },
  ])("parses supported server message $type", (message) => {
    expect(parseServerMessage(message)).toEqual(message);
  });

  it.each([
    null,
    [],
    {},
    { type: "unknown" },
    { type: "joined", tableId: "", actorId: "human-1", protocolVersion: 2, snapshot: validSnapshot },
    { type: "joined", tableId: "table-1", actorId: "", protocolVersion: 2, snapshot: validSnapshot },
    { type: "joined", tableId: "table-1", actorId: "human-1", protocolVersion: "2", snapshot: validSnapshot },
    { type: "joined", tableId: "table-1", actorId: "human-1", protocolVersion: 3, snapshot: validSnapshot, rulePack: validRulePack, seats: [{ seatId: "seat-1", label: 0, occupantId: "human-1" }] },
    { type: "joined", tableId: "table-1", actorId: "human-1", protocolVersion: 3, snapshot: validSnapshot, rulePack: validRulePack, seats: validSeats, capabilities: { ...validCapabilities, canBet: "yes" } },
    { type: "intent_result", requestId: "", event: validEvent },
    { type: "intent_result", requestId: "request-1", event: { ...validEvent, seq: -1 } },
    { type: "error", code: "internal_error", message: "bad", requestId: "" },
    { type: "snapshot", snapshot: { ...validSnapshot, seats: "not-an-array" } },
    { type: "snapshot", snapshot: { ...validSnapshot, phase: "invalid" } },
    { type: "event", event: { ...validEvent, seq: -1 } },
    { type: "event", event: { ...validEvent, seq: 1.5 } },
    { type: "event", event: { ...validEvent, actorId: "" } },
    { type: "event", event: { ...validEvent, intent: { type: "place_bet", actorId: "human-1", seatId: "seat-1", betKind: "player", amount: 0 } } },
    { type: "event", event: { ...validEvent, accepted: "yes" } },
    { type: "event", event: { ...validEvent, rejectReason: "dealer_distracted" } },
    { type: "event", event: { ...validEvent, cardsRevealed: [{ rank: "A", suit: "stars" }] } },
    { type: "event", event: { ...validEvent, cardsRevealed: "hidden" } },
    { type: "event", event: { ...validEvent, outcome: "dragon" } },
    { type: "event", event: { ...validEvent, visibleMask: [""] } },
    { type: "event", event: { ...validEvent, visibleMask: "human-1" } },
    { type: "event", event: { ...validEvent, at: -1 } },
    { type: "event", event: { ...validEvent, at: 1.5 } },
    { type: "error", code: "future_code", message: "bad" },
    { type: "error", code: "internal_error", message: "" },
    { type: "pong", nonce: Number.NaN },
  ])("rejects malformed server value %#", (value) => {
    expect(() => parseServerMessage(value)).toThrow(ServerMessageParseError);
  });

  it("retains unknown top-level and payload fields for forward compatibility", () => {
    const parsed = parseServerMessage({
      type: "joined",
      tableId: "table-1",
      actorId: "human-1",
      protocolVersion: ROOM_PROTOCOL_VERSION,
      snapshot: { ...validSnapshot, publicConfig: { minimumBet: 10 } },
      rulePack: { ...validRulePack, futureRule: true },
      seats: validSeats,
      capabilities: validCapabilities,
      futureField: "future",
    });

    expect(parsed).toMatchObject({
      futureField: "future",
      snapshot: { publicConfig: { minimumBet: 10 } },
      rulePack: { futureRule: true },
    });
  });
});
