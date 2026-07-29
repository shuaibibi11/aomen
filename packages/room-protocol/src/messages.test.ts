import { describe, expect, it } from "vitest";
import type { RoomErrorCode } from "./messages.js";

describe("room protocol error codes", () => {
  it("represents unauthorized actor joins explicitly", () => {
    const code: RoomErrorCode = "actor_not_allowed";

    expect(code).toBe("actor_not_allowed");
  });
});
