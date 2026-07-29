/**
 * Local table session tests.
 *
 * These check the part that is genuinely new: the translation between printed
 * seat numbers and engine seat identities, and that a click really does reach
 * the engine as a `place_bet` intent. The baccarat rules themselves are already
 * covered by @mct/table-engine's own suite and are not re-tested here.
 */
import { describe, expect, it } from "vitest";
import type { RulePack } from "@mct/rule-packs";
import { validateRulePack } from "@mct/rule-packs/validate";
import { DEV_RULE_PACK } from "./dev-rule-pack.js";
import { LocalTableSession } from "./local-table-session.js";
import { getSeatLabels } from "../specs/table-layout.js";

function openSession(): LocalTableSession {
  return new LocalTableSession({ variant: "mass" });
}

/**
 * The bundled pack is validated here rather than at run time.
 *
 * `table-session.ts` deliberately does not call `validateRulePack`: doing so
 * pulled zod into the browser bundle (about 20 kB gzipped) to check a JSON file
 * that the bundler inlines from this repository, so it cannot change between
 * build and run. A malformed pack is a broken build.
 *
 * These tests are what make that trade-off safe. They run the real validator in
 * Node, where the dependency costs nothing, so a pack that drifts from the
 * schema fails the suite instead of reaching a trainee.
 */
describe("rule pack", () => {
  it("satisfies the schema the server validates against", () => {
    expect(() => validateRulePack(DEV_RULE_PACK)).not.toThrow();
  });

  it("is the pack the tables expect", () => {
    expect(DEV_RULE_PACK.id).toBe("generic-macau-baccarat");
    expect(DEV_RULE_PACK.shoe.deckCount).toBe(8);
  });

  it("exposes limits the betting UI needs", () => {
    expect(DEV_RULE_PACK.limits.min).toBeGreaterThan(0);
    expect(DEV_RULE_PACK.limits.max).toBeGreaterThan(DEV_RULE_PACK.limits.min);
  });

  /**
   * Guards the guard: if the validator accepted anything, the check above would
   * pass for a pack that is missing required fields, and the build-time
   * validation would be worthless.
   */
  it("rejects a pack with a missing field", () => {
    const { limits: _removed, ...packWithoutLimits } = DEV_RULE_PACK;
    expect(() => validateRulePack(packWithoutLimits)).toThrow();
  });

  it("rejects a pack with a wrongly typed field", () => {
    const packWithBadDeckCount = {
      ...DEV_RULE_PACK,
      shoe: { ...DEV_RULE_PACK.shoe, deckCount: "eight" },
    };
    expect(() => validateRulePack(packWithBadDeckCount)).toThrow();
  });
});

describe("seat mapping", () => {
  it("creates one engine seat per printed seat", () => {
    const session = openSession();
    expect(session.getSeats().map((seat) => seat.label)).toEqual([
      ...getSeatLabels("mass"),
    ]);
  });

  it("gives the VIP variant its own seat numbering", () => {
    const session = new LocalTableSession({ variant: "vip" });
    expect(session.getSeats().map((seat) => seat.label)).toEqual([
      ...getSeatLabels("vip"),
    ]);
  });

  it("gives every seat a distinct engine id", () => {
    const seatIds = openSession().getSeats().map((seat) => seat.seatId);
    expect(new Set(seatIds).size).toBe(seatIds.length);
  });

  it("seats the guest at a real printed seat", () => {
    const session = openSession();
    const guestSeat = session.getGuestSeat();
    expect(getSeatLabels("mass")).toContain(guestSeat.label);
  });

  it("honours a requested guest seat", () => {
    const session = new LocalTableSession({ variant: "mass", guestSeatLabel: 1 });
    expect(session.getGuestSeat().label).toBe(1);
  });
});

describe("opening a session", () => {
  it("exposes only side-bet spots enabled by the authoritative rule pack", () => {
    const playerPairOnlyPack = {
      ...DEV_RULE_PACK,
      sideBets: [{ kind: "player_pair", payout: 13 }],
    } satisfies RulePack;
    const session = new LocalTableSession({
      variant: "mass",
      rulePack: playerPairOnlyPack,
    });

    expect(session.getBetSpots().map((spot) => spot.id)).toEqual([
      "player_pair",
      "player",
      "banker",
      "tie",
    ]);
    expect(
      session.getBetSpots().find((spot) => spot.id === "player_pair")?.sublabel,
    ).toBe("13 : 1");
  });

  it("always exposes main spots when the authoritative pack has no side bets", () => {
    const mainBetsOnlyPack = {
      ...DEV_RULE_PACK,
      sideBets: [],
    } satisfies RulePack;
    const session = new LocalTableSession({
      variant: "mass",
      rulePack: mainBetsOnlyPack,
    });

    expect(session.getBetSpots().map((spot) => spot.id)).toEqual([
      "player",
      "banker",
      "tie",
    ]);
  });

  it("uses the authoritative commission rate in the banker spot label", () => {
    const customCommissionPack = {
      ...DEV_RULE_PACK,
      commission: { rate: 0.07 },
    } satisfies RulePack;
    const session = new LocalTableSession({
      variant: "mass",
      rulePack: customCommissionPack,
    });

    expect(
      session.getBetSpots().find((spot) => spot.id === "banker")?.sublabel,
    ).toBe("1 : 1 扣 7%");
  });

  it("funds every seat", () => {
    const session = openSession();
    for (const seat of session.getSeats()) {
      expect(session.getStack(seat.label)).toBeGreaterThan(0);
    }
  });

  it("opens the betting window so a bet can be placed straight away", () => {
    expect(openSession().getSnapshot().phase).toBe("round_betting");
  });

  it("records the buy-ins in the event log", () => {
    const session = openSession();
    const buyInEvents = session
      .getEvents()
      .filter((event) => event.intent?.type === "buy_in");
    expect(buyInEvents).toHaveLength(session.getSeats().length);
    expect(buyInEvents.every((event) => event.accepted)).toBe(true);
  });
});

describe("placing a bet from a click", () => {
  it("is accepted at the table minimum", async () => {
    const session = openSession();
    const event = await session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min,
    );
    expect(event.accepted).toBe(true);
  });

  it("shows up in the snapshot against the clicked seat and spot", async () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    await session.placeBet(seatLabel, "banker", DEV_RULE_PACK.limits.min);

    expect(session.getBetAmount(seatLabel, "banker")).toBe(
      DEV_RULE_PACK.limits.min,
    );
    expect(session.getBetAmount(seatLabel, "player")).toBe(0);
  });

  it("keeps two seats' bets apart", async () => {
    const session = openSession();
    const [firstSeat, secondSeat] = session.getSeats();
    expect(firstSeat).toBeDefined();
    expect(secondSeat).toBeDefined();
    if (firstSeat === undefined || secondSeat === undefined) {
      return;
    }

    await session.placeBet(firstSeat.label, "player", DEV_RULE_PACK.limits.min);
    await session.placeBet(secondSeat.label, "tie", DEV_RULE_PACK.limits.min * 2);

    expect(session.getBetAmount(firstSeat.label, "player")).toBe(
      DEV_RULE_PACK.limits.min,
    );
    expect(session.getBetAmount(secondSeat.label, "tie")).toBe(
      DEV_RULE_PACK.limits.min * 2,
    );
    expect(session.getBetAmount(firstSeat.label, "tie")).toBe(0);
  });

  it("accepts the pair side bets, so the spot ids line up with the engine", async () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;

    expect(
      (await session.placeBet(seatLabel, "player_pair", DEV_RULE_PACK.limits.min)).accepted,
    ).toBe(true);
    expect(
      (await session.placeBet(seatLabel, "banker_pair", DEV_RULE_PACK.limits.min)).accepted,
    ).toBe(true);
  });

  it("locks the stake out of the seat's stack", async () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    const stackBefore = session.getStack(seatLabel);

    await session.placeBet(seatLabel, "player", DEV_RULE_PACK.limits.min);

    expect(session.getStack(seatLabel)).toBe(
      stackBefore - DEV_RULE_PACK.limits.min,
    );
  });

  it("rejects a stake below the table minimum", async () => {
    const session = openSession();
    const event = await session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min - 1,
    );
    expect(event.accepted).toBe(false);
    expect(event.rejectReason).toBe("bet_below_minimum");
  });

  it("rejects a stake above the table maximum", async () => {
    const session = openSession();
    const event = await session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.max + 1,
    );
    expect(event.accepted).toBe(false);
    expect(event.rejectReason).toBe("bet_above_maximum");
  });

  it("rejects a bet once betting has closed", async () => {
    const session = openSession();
    await session.closeBetting();
    const event = await session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min,
    );
    expect(event.accepted).toBe(false);
    expect(event.rejectReason).toBe("wrong_phase");
  });

  it("throws for a seat number that is not printed on this table", async () => {
    const session = openSession();
    await expect(session.placeBet(99, "player", DEV_RULE_PACK.limits.min)).rejects.toThrow();
  });

  it("returns the stake when bets are cleared", async () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    const stackBefore = session.getStack(seatLabel);

    await session.placeBet(seatLabel, "player", DEV_RULE_PACK.limits.min);
    await session.clearBets(seatLabel);

    expect(session.getStack(seatLabel)).toBe(stackBefore);
    expect(session.getBetAmount(seatLabel, "player")).toBe(0);
  });
});

describe("playing a round through to settlement", () => {
  it("reaches a settled outcome", async () => {
    const session = openSession();
    await session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min,
    );
    await session.dealAndSettle();

    const snapshot = session.getSnapshot();
    expect(snapshot.phase).toBe("round_end");
    expect(["player", "banker", "tie"]).toContain(snapshot.outcome);
  });

  it("deals at least the four opening cards", async () => {
    const session = openSession();
    await session.dealAndSettle();

    const hands = session.getSnapshot().hands;
    expect(hands.player.length).toBeGreaterThanOrEqual(2);
    expect(hands.banker.length).toBeGreaterThanOrEqual(2);
    expect(hands.player.length + hands.banker.length).toBeGreaterThanOrEqual(4);
  });

  it("never exceeds three cards per hand", async () => {
    const session = openSession();
    await session.dealAndSettle();

    const hands = session.getSnapshot().hands;
    expect(hands.player.length).toBeLessThanOrEqual(3);
    expect(hands.banker.length).toBeLessThanOrEqual(3);
  });

  it("pays a winning bet back into the stack", async () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    const stake = DEV_RULE_PACK.limits.min;

    // Bet every main outcome, so whichever wins pays something back.
    await session.placeBet(seatLabel, "player", stake);
    await session.placeBet(seatLabel, "banker", stake);
    await session.placeBet(seatLabel, "tie", stake);

    const stackAfterBetting = session.getStack(seatLabel);
    await session.dealAndSettle();

    expect(session.getStack(seatLabel)).toBeGreaterThan(stackAfterBetting);
  });

  it("produces the same outcome for the same shoe seed", async () => {
    const playOneRound = async (): Promise<string | null> => {
      const session = new LocalTableSession({ variant: "mass", shoeSeed: "fixed-seed" });
      await session.dealAndSettle();
      return session.getSnapshot().outcome;
    };
    expect(await playOneRound()).toBe(await playOneRound());
  });

  it("can open the next round after settling", async () => {
    const session = openSession();
    await session.dealAndSettle();
    await session.startRound();

    const snapshot = session.getSnapshot();
    expect(snapshot.phase).toBe("round_betting");
    expect(snapshot.bets).toHaveLength(0);
  });
});
