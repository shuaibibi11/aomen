/**
 * MemoryEventStore tests.
 *
 * The store's only jobs are to append events and read them back per table in
 * order, keeping tables separate. These lock that.
 */
import { describe, expect, it } from "vitest";
import { asActorId, asRoundId, asTableId, type TableEvent } from "@mct/shared";
import { MemoryEventStore } from "./memory-event-store.js";

function event(tableId: string, seq: number): TableEvent {
  return {
    tableId: asTableId(tableId),
    roundId: asRoundId(`${tableId}-round-1`),
    seq,
    actorId: asActorId("dealer"),
    phaseAfter: "round_betting",
    rulePackId: "std",
    rulePackVersion: "1.0.0",
    at: 0,
  };
}

describe("MemoryEventStore", () => {
  it("starts empty", () => {
    const store = new MemoryEventStore();
    expect(store.count()).toBe(0);
    expect(store.listByTable(asTableId("t1"))).toEqual([]);
  });

  it("appends and reads back events for a table in order", () => {
    const store = new MemoryEventStore();
    store.append(event("t1", 0));
    store.append(event("t1", 1));
    const log = store.listByTable(asTableId("t1"));
    expect(log).toHaveLength(2);
    expect(log.map((entry) => entry.seq)).toEqual([0, 1]);
  });

  it("keeps tables separate", () => {
    const store = new MemoryEventStore();
    store.append(event("t1", 0));
    store.append(event("t2", 0));
    expect(store.listByTable(asTableId("t1"))).toHaveLength(1);
    expect(store.listByTable(asTableId("t2"))).toHaveLength(1);
    expect(store.count()).toBe(2);
  });

  it("returns a copy that cannot mutate the stored event log", () => {
    const store = new MemoryEventStore();
    store.append(event("t1", 0));

    const returnedEvents = store.listByTable(asTableId("t1")) as TableEvent[];
    returnedEvents.push(event("t1", 1));

    expect(returnedEvents).toHaveLength(2);
    expect(store.listByTable(asTableId("t1"))).toHaveLength(1);
    expect(store.count()).toBe(1);
  });
});
