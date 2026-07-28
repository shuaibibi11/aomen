/**
 * Baccarat roadmap derivation.
 *
 * A Macau table displays five "roads" derived from the same outcome history.
 * Dealers and players are expected to read them, so the logic is implemented
 * properly rather than faked with decorative dots.
 *
 * Bead plate: raw history, filled top-to-bottom in six-row columns.
 * Big road:   banker/player streaks as columns; ties annotate the last cell.
 * Derived:    big eye boy, small road and cockroach pig compare column shapes
 *             in the big road and emit red (regular) or blue (irregular).
 */

export type RoundOutcome = "banker" | "player" | "tie";
export type DerivedMark = "red" | "blue";

export interface BeadPlateCell {
  readonly outcome: RoundOutcome;
  readonly bankerPair: boolean;
  readonly playerPair: boolean;
}

export interface BigRoadCell {
  readonly outcome: "banker" | "player";
  /** Ties are recorded as a slash count on the cell they land on. */
  readonly tieCount: number;
}

/** Rows available in the bead plate and big road grids. */
export const ROADMAP_ROW_COUNT = 6;

export interface RoundResult {
  readonly outcome: RoundOutcome;
  readonly bankerPair?: boolean;
  readonly playerPair?: boolean;
}

/**
 * Bead plate keeps every round including ties, filling each column downwards
 * before starting the next column.
 */
export function buildBeadPlate(
  results: readonly RoundResult[],
): BeadPlateCell[][] {
  const columns: BeadPlateCell[][] = [];

  for (const result of results) {
    const lastColumn = columns[columns.length - 1];
    const needsNewColumn =
      lastColumn === undefined || lastColumn.length >= ROADMAP_ROW_COUNT;
    const targetColumn = needsNewColumn ? [] : lastColumn;
    if (needsNewColumn) {
      columns.push(targetColumn);
    }
    targetColumn.push({
      outcome: result.outcome,
      bankerPair: result.bankerPair ?? false,
      playerPair: result.playerPair ?? false,
    });
  }

  return columns;
}

/**
 * Big road drops ties into the previous cell as a slash mark, and starts a new
 * column whenever the winner changes. A column that reaches the bottom row
 * continues sideways as a "dragon tail", which is modelled here by letting the
 * column grow beyond six entries; the renderer handles the turn.
 */
export function buildBigRoad(
  results: readonly RoundResult[],
): BigRoadCell[][] {
  const columns: BigRoadCell[][] = [];

  for (const result of results) {
    if (result.outcome === "tie") {
      const lastColumn = columns[columns.length - 1];
      const lastCell = lastColumn?.[lastColumn.length - 1];
      if (lastCell !== undefined && lastColumn !== undefined) {
        lastColumn[lastColumn.length - 1] = {
          outcome: lastCell.outcome,
          tieCount: lastCell.tieCount + 1,
        };
      }
      // A tie before any decision has nowhere to attach and is dropped, which
      // matches how a live board shows nothing until the first banker/player.
      continue;
    }

    const lastColumn = columns[columns.length - 1];
    const lastCell = lastColumn?.[lastColumn.length - 1];
    const continuesStreak =
      lastColumn !== undefined &&
      lastCell !== undefined &&
      lastCell.outcome === result.outcome;

    if (continuesStreak) {
      lastColumn.push({ outcome: result.outcome, tieCount: 0 });
    } else {
      columns.push([{ outcome: result.outcome, tieCount: 0 }]);
    }
  }

  return columns;
}

/**
 * Column offset each derived road uses when comparing big-road shapes.
 * Big eye boy looks one column back, small road two, cockroach pig three.
 */
const DERIVED_ROAD_OFFSETS = {
  bigEyeBoy: 1,
  smallRoad: 2,
  cockroachPig: 3,
} as const;

export type DerivedRoadName = keyof typeof DERIVED_ROAD_OFFSETS;

/**
 * Derive one road from the big road.
 *
 * For each new big-road entry, the road asks a question about earlier columns
 * and answers red for "regular" or blue for "irregular":
 *
 * - When the entry starts a new column, compare the heights of the two columns
 *   sitting `offset` and `offset + 1` back. Equal heights are red.
 * - Otherwise, check whether the column `offset` back is already tall enough to
 *   contain the current row. If it is, the pattern repeats and the mark is red.
 */
export function buildDerivedRoad(
  bigRoad: readonly (readonly BigRoadCell[])[],
  roadName: DerivedRoadName,
): DerivedMark[] {
  const offset = DERIVED_ROAD_OFFSETS[roadName];
  const marks: DerivedMark[] = [];

  for (let columnIndex = 0; columnIndex < bigRoad.length; columnIndex += 1) {
    const column = bigRoad[columnIndex];
    if (column === undefined) {
      continue;
    }

    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const isColumnStart = rowIndex === 0;

      if (isColumnStart) {
        // A derived road only begins once enough history exists to compare.
        const earlierIndex = columnIndex - offset;
        const previousIndex = earlierIndex - 1;
        if (previousIndex < 0) {
          continue;
        }
        const earlierHeight = bigRoad[earlierIndex]?.length ?? 0;
        const previousHeight = bigRoad[previousIndex]?.length ?? 0;
        marks.push(earlierHeight === previousHeight ? "red" : "blue");
        continue;
      }

      const comparisonIndex = columnIndex - offset;
      if (comparisonIndex < 0) {
        continue;
      }
      const comparisonHeight = bigRoad[comparisonIndex]?.length ?? 0;
      // rowIndex is zero-based, so a comparison column needs rowIndex + 1 cells
      // to already cover the row currently being filled.
      marks.push(comparisonHeight >= rowIndex + 1 ? "red" : "blue");
    }
  }

  return marks;
}

export interface RoadmapView {
  readonly beadPlate: BeadPlateCell[][];
  readonly bigRoad: BigRoadCell[][];
  readonly bigEyeBoy: DerivedMark[];
  readonly smallRoad: DerivedMark[];
  readonly cockroachPig: DerivedMark[];
  readonly bankerWins: number;
  readonly playerWins: number;
  readonly ties: number;
}

/** Build all five roads plus the running tally shown on a real board. */
export function buildRoadmapView(results: readonly RoundResult[]): RoadmapView {
  const bigRoad = buildBigRoad(results);

  return {
    beadPlate: buildBeadPlate(results),
    bigRoad,
    bigEyeBoy: buildDerivedRoad(bigRoad, "bigEyeBoy"),
    smallRoad: buildDerivedRoad(bigRoad, "smallRoad"),
    cockroachPig: buildDerivedRoad(bigRoad, "cockroachPig"),
    bankerWins: results.filter((result) => result.outcome === "banker").length,
    playerWins: results.filter((result) => result.outcome === "player").length,
    ties: results.filter((result) => result.outcome === "tie").length,
  };
}
