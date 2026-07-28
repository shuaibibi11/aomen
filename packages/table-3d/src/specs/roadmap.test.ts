/**
 * Roadmap derivation tests.
 *
 * These lock the reading rules a dealer is expected to know: ties annotate the
 * big road rather than occupying a cell, streaks form columns, and the derived
 * roads only start once enough columns exist to compare.
 */
import { describe, expect, it } from "vitest";
import {
  buildBeadPlate,
  buildBigRoad,
  buildDerivedRoad,
  buildRoadmapView,
  ROADMAP_ROW_COUNT,
  type RoundResult,
} from "./roadmap.js";

function toResults(outcomes: string): RoundResult[] {
  const outcomeByLetter: Record<string, RoundResult["outcome"]> = {
    B: "banker",
    P: "player",
    T: "tie",
  };
  return [...outcomes].map((letter) => {
    const outcome = outcomeByLetter[letter];
    if (outcome === undefined) {
      throw new Error(`Unknown outcome letter: ${letter}`);
    }
    return { outcome };
  });
}

describe("bead plate", () => {
  it("keeps ties as their own cell", () => {
    const columns = buildBeadPlate(toResults("BTP"));
    expect(columns[0]?.map((cell) => cell.outcome)).toEqual([
      "banker",
      "tie",
      "player",
    ]);
  });

  it("wraps to a new column after six rounds", () => {
    const columns = buildBeadPlate(toResults("BBBBBBB"));
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(ROADMAP_ROW_COUNT);
    expect(columns[1]).toHaveLength(1);
  });

  it("carries pair flags through", () => {
    const columns = buildBeadPlate([
      { outcome: "banker", bankerPair: true, playerPair: false },
    ]);
    expect(columns[0]?.[0]?.bankerPair).toBe(true);
    expect(columns[0]?.[0]?.playerPair).toBe(false);
  });

  it("returns nothing for an empty shoe", () => {
    expect(buildBeadPlate([])).toEqual([]);
  });
});

describe("big road", () => {
  it("stacks a streak into one column", () => {
    const columns = buildBigRoad(toResults("BBB"));
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(3);
  });

  it("starts a new column when the winner changes", () => {
    const columns = buildBigRoad(toResults("BBPP"));
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(2);
    expect(columns[1]).toHaveLength(2);
  });

  it("records a tie as a slash on the previous cell, not a new cell", () => {
    const columns = buildBigRoad(toResults("BTB"));
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(2);
    expect(columns[0]?.[0]?.tieCount).toBe(1);
  });

  it("counts consecutive ties on the same cell", () => {
    const columns = buildBigRoad(toResults("BTT"));
    expect(columns[0]?.[0]?.tieCount).toBe(2);
  });

  it("drops a tie that arrives before any decision", () => {
    expect(buildBigRoad(toResults("T"))).toEqual([]);
  });

  it("does not break the streak across a tie", () => {
    const columns = buildBigRoad(toResults("BTB"));
    expect(columns[0]?.every((cell) => cell.outcome === "banker")).toBe(true);
  });
});

describe("derived roads", () => {
  it("produces nothing until enough columns exist", () => {
    const bigRoad = buildBigRoad(toResults("BP"));
    expect(buildDerivedRoad(bigRoad, "bigEyeBoy")).toEqual([]);
    expect(buildDerivedRoad(bigRoad, "cockroachPig")).toEqual([]);
  });

  it("starts big eye boy earlier than cockroach pig", () => {
    const bigRoad = buildBigRoad(toResults("BPBPBPBP"));
    const bigEyeBoy = buildDerivedRoad(bigRoad, "bigEyeBoy");
    const cockroachPig = buildDerivedRoad(bigRoad, "cockroachPig");
    expect(bigEyeBoy.length).toBeGreaterThan(cockroachPig.length);
  });

  it("marks a perfectly alternating shoe as regular", () => {
    // Every column is one tall, so column heights always match: all red.
    const bigRoad = buildBigRoad(toResults("BPBPBPBP"));
    const bigEyeBoy = buildDerivedRoad(bigRoad, "bigEyeBoy");
    expect(bigEyeBoy.length).toBeGreaterThan(0);
    expect(bigEyeBoy.every((mark) => mark === "red")).toBe(true);
  });

  it("emits only red or blue marks", () => {
    const bigRoad = buildBigRoad(toResults("BBPBPPBPBBPB"));
    for (const roadName of ["bigEyeBoy", "smallRoad", "cockroachPig"] as const) {
      for (const mark of buildDerivedRoad(bigRoad, roadName)) {
        expect(["red", "blue"]).toContain(mark);
      }
    }
  });
});

describe("roadmap view", () => {
  it("tallies each outcome", () => {
    const view = buildRoadmapView(toResults("BBPTP"));
    expect(view.bankerWins).toBe(2);
    expect(view.playerWins).toBe(2);
    expect(view.ties).toBe(1);
  });

  it("builds all five roads", () => {
    const view = buildRoadmapView(toResults("BBPBPPBPBBPB"));
    expect(view.beadPlate.length).toBeGreaterThan(0);
    expect(view.bigRoad.length).toBeGreaterThan(0);
    expect(view.bigEyeBoy.length).toBeGreaterThan(0);
    expect(view.smallRoad.length).toBeGreaterThan(0);
    expect(view.cockroachPig.length).toBeGreaterThan(0);
  });

  it("counts every non-tie round exactly once in the big road", () => {
    const results = toResults("BBPBPPBPBBPBTP");
    const view = buildRoadmapView(results);
    const bigRoadCellCount = view.bigRoad.reduce(
      (total, column) => total + column.length,
      0,
    );
    expect(bigRoadCellCount).toBe(view.bankerWins + view.playerWins);
  });
});
