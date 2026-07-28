/**
 * Public surface of @mct/table-engine.
 *
 * The authoritative baccarat runtime. Pure logic only: no DOM, no network. This
 * barrel re-exports the pieces as they are built (draw table first).
 */
export * from "./baccarat/draw-table.js";
export * from "./baccarat/shoe.js";
export * from "./rng.js";
