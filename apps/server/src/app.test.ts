import { afterEach, describe, expect, it } from "vitest";
import { asActorId } from "@mct/shared";
import { createApp } from "./app.js";

const ORIGINAL_DEMO_ROOM_CREDENTIAL = process.env.DEMO_ROOM_CREDENTIAL;
const DEMO_HUMAN_ACTOR_ID = asActorId("demo-human");

afterEach(() => {
  if (ORIGINAL_DEMO_ROOM_CREDENTIAL === undefined) {
    delete process.env.DEMO_ROOM_CREDENTIAL;
    return;
  }

  process.env.DEMO_ROOM_CREDENTIAL = ORIGINAL_DEMO_ROOM_CREDENTIAL;
});

describe("createApp room credential configuration", () => {
  it("prefers an explicitly provided credential over the environment", async () => {
    const optionCredential = "option-test-credential";
    process.env.DEMO_ROOM_CREDENTIAL = "environment-test-credential";

    const app = await createApp({ demoRoomCredential: optionCredential });

    expect(
      app.demoRoom.canClientJoin(DEMO_HUMAN_ACTOR_ID, optionCredential),
    ).toBe(true);
    expect(
      app.demoRoom.canClientJoin(
        DEMO_HUMAN_ACTOR_ID,
        process.env.DEMO_ROOM_CREDENTIAL,
      ),
    ).toBe(false);
  });

  it("uses the environment credential when no option is provided", async () => {
    const environmentCredential = "environment-only-test-credential";
    process.env.DEMO_ROOM_CREDENTIAL = environmentCredential;

    const app = await createApp();

    expect(
      app.demoRoom.canClientJoin(DEMO_HUMAN_ACTOR_ID, environmentCredential),
    ).toBe(true);
  });

  it.each([undefined, "", "   "])(
    "rejects startup without a usable credential (environment: %j)",
    async (environmentCredential) => {
      if (environmentCredential === undefined) {
        delete process.env.DEMO_ROOM_CREDENTIAL;
      } else {
        process.env.DEMO_ROOM_CREDENTIAL = environmentCredential;
      }

      const startup = createApp();

      await expect(startup).rejects.toThrowError(
        new Error(
          "Demo room join credential must be configured through AppOptions or DEMO_ROOM_CREDENTIAL",
        ),
      );
    },
  );
});
