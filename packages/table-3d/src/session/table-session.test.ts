/**
 * Table session tests.
 *
 * These check the part that is genuinely new: the translation between printed
 * seat numbers and engine seat identities, and that a click really does reach
 * the engine as a `place_bet` intent. The baccarat rules themselves are already
 * covered by @mct/table-engine's own suite and are not re-tested here.
 */
import { describe, expect, it } from "vitest";
import { validateRulePack } from "@mct/rule-packs/validate";
import { DEV_RULE_PACK, TableSession } from "./table-session.js";
import { getSeatLabels } from "../specs/table-layout.js";

function openSession(): TableSession {
  return new TableSession({ variant: "mass" });
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
    const session = new TableSession({ variant: "vip" });
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
    const session = new TableSession({ variant: "mass", guestSeatLabel: 1 });
    expect(session.getGuestSeat().label).toBe(1);
  });
});

describe("opening a session", () => {
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
  it("is accepted at the table minimum", () => {
    const session = openSession();
    const event = session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min,
    );
    expect(event.accepted).toBe(true);
  });

  it("shows up in the snapshot against the clicked seat and spot", () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    session.placeBet(seatLabel, "banker", DEV_RULE_PACK.limits.min);

    expect(session.getBetAmount(seatLabel, "banker")).toBe(
      DEV_RULE_PACK.limits.min,
    );
    expect(session.getBetAmount(seatLabel, "player")).toBe(0);
  });

  it("keeps two seats' bets apart", () => {
    const session = openSession();
    const [firstSeat, secondSeat] = session.getSeats();
    expect(firstSeat).toBeDefined();
    expect(secondSeat).toBeDefined();
    if (firstSeat === undefined || secondSeat === undefined) {
      return;
    }

    session.placeBet(firstSeat.label, "player", DEV_RULE_PACK.limits.min);
    session.placeBet(secondSeat.label, "tie", DEV_RULE_PACK.limits.min * 2);

    expect(session.getBetAmount(firstSeat.label, "player")).toBe(
      DEV_RULE_PACK.limits.min,
    );
    expect(session.getBetAmount(secondSeat.label, "tie")).toBe(
      DEV_RULE_PACK.limits.min * 2,
    );
    expect(session.getBetAmount(firstSeat.label, "tie")).toBe(0);
  });

  it("accepts the pair side bets, so the spot ids line up with the engine", () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;

    expect(
      session.placeBet(seatLabel, "player_pair", DEV_RULE_PACK.limits.min).accepted,
    ).toBe(true);
    expect(
      session.placeBet(seatLabel, "banker_pair", DEV_RULE_PACK.limits.min).accepted,
    ).toBe(true);
  });

  it("locks the stake out of the seat's stack", () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    const stackBefore = session.getStack(seatLabel);

    session.placeBet(seatLabel, "player", DEV_RULE_PACK.limits.min);

    expect(session.getStack(seatLabel)).toBe(
      stackBefore - DEV_RULE_PACK.limits.min,
    );
  });

  it("rejects a stake below the table minimum", () => {
    const session = openSession();
    const event = session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min - 1,
    );
    expect(event.accepted).toBe(false);
    expect(event.rejectReason).toBe("bet_below_minimum");
  });

  it("rejects a stake above the table maximum", () => {
    const session = openSession();
    const event = session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.max + 1,
    );
    expect(event.accepted).toBe(false);
    expect(event.rejectReason).toBe("bet_above_maximum");
  });

  it("rejects a bet once betting has closed", () => {
    const session = openSession();
    session.closeBetting();
    const event = session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min,
    );
    expect(event.accepted).toBe(false);
    expect(event.rejectReason).toBe("wrong_phase");
  });

  it("throws for a seat number that is not printed on this table", () => {
    const session = openSession();
    expect(() => session.placeBet(99, "player", DEV_RULE_PACK.limits.min)).toThrow();
  });

  it("returns the stake when bets are cleared", () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    const stackBefore = session.getStack(seatLabel);

    session.placeBet(seatLabel, "player", DEV_RULE_PACK.limits.min);
    session.clearBets(seatLabel);

    expect(session.getStack(seatLabel)).toBe(stackBefore);
    expect(session.getBetAmount(seatLabel, "player")).toBe(0);
  });
});

describe("playing a round through to settlement", () => {
  it("reaches a settled outcome", () => {
    const session = openSession();
    session.placeBet(
      session.getGuestSeat().label,
      "player",
      DEV_RULE_PACK.limits.min,
    );
    session.dealAndSettle();

    const snapshot = session.getSnapshot();
    expect(snapshot.phase).toBe("round_end");
    expect(["player", "banker", "tie"]).toContain(snapshot.outcome);
  });

  it("deals at least the four opening cards", () => {
    const session = openSession();
    session.dealAndSettle();

    const hands = session.getSnapshot().hands;
    expect(hands.player.length).toBeGreaterThanOrEqual(2);
    expect(hands.banker.length).toBeGreaterThanOrEqual(2);
    expect(hands.player.length + hands.banker.length).toBeGreaterThanOrEqual(4);
  });

  it("never exceeds three cards per hand", () => {
    const session = openSession();
    session.dealAndSettle();

    const hands = session.getSnapshot().hands;
    expect(hands.player.length).toBeLessThanOrEqual(3);
    expect(hands.banker.length).toBeLessThanOrEqual(3);
  });

  it("pays a winning bet back into the stack", () => {
    const session = openSession();
    const seatLabel = session.getGuestSeat().label;
    const stake = DEV_RULE_PACK.limits.min;

    // Bet every main outcome, so whichever wins pays something back.
    session.placeBet(seatLabel, "player", stake);
    session.placeBet(seatLabel, "banker", stake);
    session.placeBet(seatLabel, "tie", stake);

    const stackAfterBetting = session.getStack(seatLabel);
    session.dealAndSettle();

    expect(session.getStack(seatLabel)).toBeGreaterThan(stackAfterBetting);
  });

  it("produces the same outcome for the same shoe seed", () => {
    const playOneRound = (): string | null => {
      const session = new TableSession({ variant: "mass", shoeSeed: "fixed-seed" });
      session.dealAndSettle();
      return session.getSnapshot().outcome;
    };
    expect(playOneRound()).toBe(playOneRound());
  });

  it("can open the next round after settling", () => {
    const session = openSession();
    session.dealAndSettle();
    session.startRound();

    const snapshot = session.getSnapshot();
    expect(snapshot.phase).toBe("round_betting");
    expect(snapshot.bets).toHaveLength(0);
  });
});
