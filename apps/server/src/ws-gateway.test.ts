import { describe, expect, it } from "vitest";
import { asActorId, SYSTEM_DEALER } from "@mct/shared";
import { getIntentActorError } from "./ws-gateway.js";

describe("WebSocket actor binding", () => {
  const joinedActorId = asActorId("joined-human");

  it("accepts an intent from the actor bound at join", () => {
    expect(
      getIntentActorError(joinedActorId, {
        type: "start_round",
        actorId: joinedActorId,
      }),
    ).toBeNull();
  });

  it("rejects an intent carrying another actor identity", () => {
    expect(
      getIntentActorError(joinedActorId, {
        type: "start_round",
        actorId: asActorId("different-human"),
      }),
    ).toBe("actor_mismatch");
  });

  it("rejects system dealer intents from ordinary sockets", () => {
    expect(
      getIntentActorError(joinedActorId, {
        type: "start_round",
        actorId: SYSTEM_DEALER,
      }),
    ).toBe("actor_mismatch");
  });
});
