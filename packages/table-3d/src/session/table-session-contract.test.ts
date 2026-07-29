import { describe, expect, it, vi } from "vitest";
import type { TableEvent, TableSnapshot } from "@mct/shared";
import { DEV_RULE_PACK } from "./dev-rule-pack.js";
import { LocalTableSession } from "./local-table-session.js";
import {
  createTableSessionNotifier,
  type TableSessionFactory,
} from "./table-session.js";

const localSessionFactory: TableSessionFactory = async (options) =>
  new LocalTableSession(options);

function runTableSessionContract(
  name: string,
  createSession: TableSessionFactory,
): void {
  describe(name, () => {
    it("publishes the authoritative snapshot after a legal bet", async () => {
      const session = await createSession({ variant: "mass" });
      const updates: TableSnapshot[] = [];
      session.subscribe(({ snapshot }) => updates.push(snapshot));

      const command = session.placeBet(
        session.getGuestSeat().label,
        "player",
        DEV_RULE_PACK.limits.min,
      );
      expect(command).toBeInstanceOf(Promise);
      const event = await command;

      expect(event.accepted).toBe(true);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.lastEventSeq).toBe(event.seq);
      expect(session.getBetAmount(session.getGuestSeat().label, "player")).toBe(
        DEV_RULE_PACK.limits.min,
      );
    });

    it("publishes a rejection without fabricating a bet", async () => {
      const session = await createSession({ variant: "mass" });
      const updates: TableSnapshot[] = [];
      session.subscribe(({ snapshot }) => updates.push(snapshot));

      const event = await session.placeBet(
        session.getGuestSeat().label,
        "player",
        DEV_RULE_PACK.limits.min - 1,
      );

      expect(event.accepted).toBe(false);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.bets).toHaveLength(0);
      expect(session.getSnapshot().bets).toHaveLength(0);
    });

    it("stops notifying an unsubscribed listener", async () => {
      const session = await createSession({ variant: "mass" });
      const listener = vi.fn();
      const unsubscribe = session.subscribe(listener);
      unsubscribe();

      await session.placeBet(
        session.getGuestSeat().label,
        "player",
        DEV_RULE_PACK.limits.min,
      );

      expect(listener).not.toHaveBeenCalled();
    });

    it("stops notifying listeners after disposal", async () => {
      const session = await createSession({ variant: "mass" });
      const listener = vi.fn();
      session.subscribe(listener);
      session.dispose();

      await expect(session.placeBet(
        session.getGuestSeat().label,
        "player",
        DEV_RULE_PACK.limits.min,
      )).rejects.toThrow("disposed");
      expect(listener).not.toHaveBeenCalled();
    });
  });
}

runTableSessionContract("LocalTableSession contract", localSessionFactory);

describe("table session notifier", () => {
  it("does not publish the same authoritative sequence twice", () => {
    const snapshot = { lastEventSeq: 42 } as TableSnapshot;
    const event = { seq: 42 } as TableEvent;
    const listener = vi.fn();
    const notifier = createTableSessionNotifier(() => snapshot);
    notifier.subscribe(listener);

    notifier.publish(event);
    notifier.publish(event);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not publish a snapshot older than the latest published sequence", () => {
    let snapshot = { lastEventSeq: 42 } as TableSnapshot;
    const listener = vi.fn();
    const notifier = createTableSessionNotifier(() => snapshot);
    notifier.subscribe(listener);

    notifier.publish({ seq: 42 } as TableEvent);
    snapshot = { lastEventSeq: 41 } as TableSnapshot;
    notifier.publish({ seq: 41 } as TableEvent);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when an event and its snapshot sequence differ", () => {
    const snapshot = { lastEventSeq: 42 } as TableSnapshot;
    const listener = vi.fn();
    const notifier = createTableSessionNotifier(() => snapshot);
    notifier.subscribe(listener);

    expect(() => notifier.publish({ seq: 43 } as TableEvent)).toThrow(
      "Table session update sequence mismatch: event 43, snapshot 42",
    );
    expect(listener).not.toHaveBeenCalled();
  });
});
