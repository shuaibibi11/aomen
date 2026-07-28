/**
 * A worked shoe of results used to populate the roadmap preview.
 *
 * The sequence is hand-built to exercise every reading rule: long banker and
 * player streaks, single-round chops, consecutive ties, and pairs. Without
 * these cases the derived roads would all look the same and a layout mistake
 * would go unnoticed.
 */
import type { RoundResult } from "./roadmap.js";

export const SAMPLE_SHOE_RESULTS: readonly RoundResult[] = [
  { outcome: "banker", bankerPair: true },
  { outcome: "banker" },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "tie" },
  { outcome: "player", playerPair: true },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "banker" },
  { outcome: "banker" },
  { outcome: "banker" },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "player" },
  { outcome: "tie" },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "banker", bankerPair: true },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "player" },
  { outcome: "player" },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "banker" },
  { outcome: "banker" },
  { outcome: "player", playerPair: true },
  { outcome: "banker" },
  { outcome: "player" },
  { outcome: "player" },
];
