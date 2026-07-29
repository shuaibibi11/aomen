import { describe, expect, it, vi } from "vitest";
import { LocalTableSession } from "../session/local-table-session.js";
import { getCasinoTheme } from "../specs/casino-theme.js";
import { BetInteraction } from "./bet-interaction.js";

interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  readonly resolve: (value: TValue) => void;
  readonly reject: (reason: unknown) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise!: (value: TValue) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<TValue>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function createInteraction(
  session: LocalTableSession,
  callbacks: {
    readonly onPendingChanged?: (pending: boolean) => void;
    readonly onBetAttempt?: () => void;
    readonly onCommandError?: (error: unknown) => void;
  } = {},
): BetInteraction {
  return new BetInteraction({
    session,
    theme: getCasinoTheme("sands-venetian"),
    casinoId: "sands-venetian",
    variant: "mass",
    surfaceY: 0,
    ...callbacks,
  });
}

function createPlayerHit(session: LocalTableSession) {
  return {
    seatLabel: session.getGuestSeat().label,
    spotId: "player" as const,
    localX: 0,
    localZ: 0,
  };
}

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
    const interaction = createInteraction(session);
    const hit = createPlayerHit(session);

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

  it("silences a pending bet after disposal and resets its local pending state", async () => {
    const session = new LocalTableSession({ variant: "mass" });
    vi.spyOn(session, "subscribe").mockReturnValue(vi.fn());
    const originalPlaceBet = session.placeBet.bind(session);
    const remoteResult = createDeferred<Awaited<ReturnType<typeof session.placeBet>>>();
    vi.spyOn(session, "placeBet").mockReturnValue(remoteResult.promise);
    const onPendingChanged = vi.fn();
    const onBetAttempt = vi.fn();
    const onCommandError = vi.fn();
    const interaction = createInteraction(session, {
      onPendingChanged,
      onBetAttempt,
      onCommandError,
    });

    const pendingBet = interaction.placeBetAtSpot(createPlayerHit(session));
    expect(interaction.isPending()).toBe(true);
    expect(onPendingChanged).toHaveBeenCalledTimes(1);

    interaction.dispose();
    expect(interaction.isPending()).toBe(false);
    remoteResult.resolve(
      await originalPlaceBet(
        session.getGuestSeat().label,
        "player",
        session.getRulePack().limits.min,
      ),
    );
    await pendingBet;

    expect(onPendingChanged).toHaveBeenCalledTimes(1);
    expect(onBetAttempt).not.toHaveBeenCalled();
    expect(onCommandError).not.toHaveBeenCalled();
  });

  it("keeps a newer interaction pending when an old command completes", async () => {
    const oldSession = new LocalTableSession({ variant: "mass" });
    const newSession = new LocalTableSession({ variant: "mass" });
    vi.spyOn(oldSession, "subscribe").mockReturnValue(vi.fn());
    vi.spyOn(newSession, "subscribe").mockReturnValue(vi.fn());
    const oldResult = createDeferred<Awaited<ReturnType<typeof oldSession.placeBet>>>();
    const newResult = createDeferred<Awaited<ReturnType<typeof newSession.placeBet>>>();
    vi.spyOn(oldSession, "placeBet").mockReturnValue(oldResult.promise);
    vi.spyOn(newSession, "placeBet").mockReturnValue(newResult.promise);
    let sharedPending = false;
    const oldFeedback = vi.fn();
    const newFeedback = vi.fn();
    let currentInteraction: BetInteraction;
    let oldInteraction!: BetInteraction;
    oldInteraction = createInteraction(oldSession, {
      onPendingChanged: (pending) => {
        if (currentInteraction === oldInteraction) {
          sharedPending = pending;
        }
      },
      onBetAttempt: oldFeedback,
    });
    currentInteraction = oldInteraction;
    const oldCommand = oldInteraction.placeBetAtSpot(createPlayerHit(oldSession));

    oldInteraction.dispose();
    let newInteraction!: BetInteraction;
    newInteraction = createInteraction(newSession, {
      onPendingChanged: (pending) => {
        if (currentInteraction === newInteraction) {
          sharedPending = pending;
        }
      },
      onBetAttempt: newFeedback,
    });
    currentInteraction = newInteraction;
    sharedPending = false;
    const newCommand = newInteraction.placeBetAtSpot(createPlayerHit(newSession));
    expect(sharedPending).toBe(true);

    oldResult.reject(new Error("stale remote failure"));
    await expect(oldCommand).resolves.toBeNull();

    expect(sharedPending).toBe(true);
    expect(oldFeedback).not.toHaveBeenCalled();
    expect(newFeedback).not.toHaveBeenCalled();

    newInteraction.dispose();
    newResult.reject(new Error("new interaction disposed"));
    await expect(newCommand).resolves.toBeNull();
  });

  it("reports a remote bet rejection once without rejecting the pointer command", async () => {
    const session = new LocalTableSession({ variant: "mass" });
    vi.spyOn(session, "subscribe").mockReturnValue(vi.fn());
    const remoteError = new Error("remote bet rejected");
    vi.spyOn(session, "placeBet").mockRejectedValue(remoteError);
    const onBetAttempt = vi.fn();
    const onCommandError = vi.fn();
    const interaction = createInteraction(session, {
      onBetAttempt,
      onCommandError,
    });

    await expect(
      interaction.placeBetAtSpot(createPlayerHit(session)),
    ).resolves.toBeNull();

    expect(onCommandError).toHaveBeenCalledOnce();
    expect(onCommandError).toHaveBeenCalledWith(remoteError);
    expect(onBetAttempt).not.toHaveBeenCalled();
    expect(interaction.isPending()).toBe(false);
  });
});
