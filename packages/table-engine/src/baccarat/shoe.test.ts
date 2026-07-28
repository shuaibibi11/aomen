/**
 * Seeded shoe tests.
 *
 * A shoe is a shuffled multi-deck stack dealt one card at a time. The same seed
 * must reproduce the exact card order so a session can be replayed, and drawing
 * past the end must fail loudly rather than return junk.
 */
import { describe, expect, it } from "vitest";
import { CARDS_PER_SHOE } from "@mct/shared";
import { createShoe } from "./shoe.js";

describe("createShoe", () => {
  it("holds deckCount * 52 cards", () => {
    const oneDeck = createShoe({ seed: "s", deckCount: 1 });
    expect(oneDeck.remaining()).toBe(52);

    const eightDecks = createShoe({ seed: "s", deckCount: 8 });
    expect(eightDecks.remaining()).toBe(CARDS_PER_SHOE);
  });

  it("deals the same card order for the same seed", () => {
    const first = createShoe({ seed: "same-seed", deckCount: 1 });
    const second = createShoe({ seed: "same-seed", deckCount: 1 });
    const firstOrder = Array.from({ length: 52 }, () => first.draw());
    const secondOrder = Array.from({ length: 52 }, () => second.draw());
    expect(firstOrder).toEqual(secondOrder);
  });

  it("deals a different order for a different seed", () => {
    const first = createShoe({ seed: "seed-x", deckCount: 1 });
    const second = createShoe({ seed: "seed-y", deckCount: 1 });
    const firstOrder = Array.from({ length: 52 }, () => first.draw());
    const secondOrder = Array.from({ length: 52 }, () => second.draw());
    expect(firstOrder).not.toEqual(secondOrder);
  });

  it("contains exactly the right multiset of cards", () => {
    const shoe = createShoe({ seed: "count-seed", deckCount: 1 });
    const counts = new Map<string, number>();
    for (let index = 0; index < 52; index += 1) {
      const card = shoe.draw();
      const key = `${card.rank}-${card.suit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // A single deck has 52 distinct cards, each appearing exactly once.
    expect(counts.size).toBe(52);
    for (const count of counts.values()) {
      expect(count).toBe(1);
    }
  });

  it("tracks remaining count as cards are drawn", () => {
    const shoe = createShoe({ seed: "remaining-seed", deckCount: 1 });
    expect(shoe.remaining()).toBe(52);
    shoe.draw();
    expect(shoe.remaining()).toBe(51);
  });

  it("throws when drawing from an empty shoe", () => {
    const shoe = createShoe({ seed: "empty-seed", deckCount: 1 });
    for (let index = 0; index < 52; index += 1) {
      shoe.draw();
    }
    expect(shoe.remaining()).toBe(0);
    expect(() => shoe.draw()).toThrow();
  });
});
