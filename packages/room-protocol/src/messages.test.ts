import { describe, expect, it } from "vitest";
import {
  ROOM_ERROR_CODES,
  isRoomErrorCode,
} from "./messages.js";

describe("room protocol error codes", () => {
  it("exports the complete runtime-checkable error code set", () => {
    expect(ROOM_ERROR_CODES).toEqual([
      "unknown_room",
      "not_joined",
      "actor_not_allowed",
      "actor_mismatch",
      "intent_not_allowed",
      "malformed_message",
      "internal_error",
    ]);
  });

  it("recognizes protocol error codes at runtime", () => {
    expect(isRoomErrorCode("intent_not_allowed")).toBe(true);
    expect(isRoomErrorCode("internal_error")).toBe(true);
    expect(isRoomErrorCode("database_exploded")).toBe(false);
    expect(isRoomErrorCode(null)).toBe(false);
  });
});
