import { describe, expect, it, vi } from "vitest";
import { LocalTableSession } from "../session/local-table-session.js";
import { getCasinoTheme } from "../specs/casino-theme.js";
import { BetInteraction } from "./bet-interaction.js";

describe("BetInteraction", () => {
  it("uses the injected session and blocks duplicate pending commands", async () => {
    const session = new LocalTableSession({ variant: "mass" });
    const unsubscribe = vi.fn();
    vi.spyOn(session, "subscribe").mockReturnValue(unsubscribe);
    const originalPlaceBet = session.placeBet.bind(session);
    let releaseCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const placeBet = vi.spyOn(session, "placeBet").mockImplementation(async (...argumentsList) => {
      await commandGate;
      return originalPlaceBet(...argumentsList);
    });
    const interaction = new BetInteraction({
      session,
      theme: getCasinoTheme("sands-venetian"),
      casinoId: "sands-venetian",
      variant: "mass",
      surfaceY: 0,
    });
    const hit = {
      seatLabel: session.getGuestSeat().label,
      spotId: "player" as const,
      localX: 0,
      localZ: 0,
    };

    const firstAttempt = interaction.placeBetAtSpot(hit);
    const duplicateAttempt = interaction.placeBetAtSpot(hit);

    expect(interaction.getSession()).toBe(session);
    expect(interaction.isPending()).toBe(true);
    expect(await duplicateAttempt).toBeNull();
    expect(placeBet).toHaveBeenCalledTimes(1);
    releaseCommand();
    await firstAttempt;
    expect(interaction.isPending()).toBe(false);

    interaction.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
