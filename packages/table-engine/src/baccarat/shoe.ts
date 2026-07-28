/**
 * Seeded dealing shoe.
 *
 * A shoe is one or more standard 52-card decks shuffled together and dealt one
 * card at a time. The shuffle is driven by a seeded RNG so the same seed always
 * yields the same card order, which is what lets a session be replayed. Drawing
 * past the last card throws rather than returning junk.
 *
 * This phase does not implement cut-card penetration reshuffling; the shoe is
 * dealt straight through until empty.
 */
import { RANKS, SUITS, type Card } from "@mct/shared";
import { createSeededRng } from "../rng.js";

export interface ShoeOptions {
  readonly seed: string;
  readonly deckCount: number;
}

export interface Shoe {
  /** Deal the next card. Throws if the shoe is empty. */
  draw(): Card;
  /** How many cards are left undealt. */
  remaining(): number;
}

/** Build one unshuffled deck: every rank in every suit. */
function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Build `deckCount` decks stacked together, still unshuffled. */
function buildStackedDecks(deckCount: number): Card[] {
  const cards: Card[] = [];
  for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
    cards.push(...buildDeck());
  }
  return cards;
}

/**
 * Shuffle in place with Fisher–Yates, using the seeded RNG. Iterating from the
 * top down and swapping with a random earlier-or-equal index gives an unbiased
 * permutation.
 */
function shuffleInPlace(cards: Card[], rng: ReturnType<typeof createSeededRng>): void {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    const temporary = cards[index]!;
    cards[index] = cards[swapIndex]!;
    cards[swapIndex] = temporary;
  }
}

/**
 * Create a shuffled shoe. Cards are dealt from the end of the array so drawing
 * is an O(1) pop, and `remaining` is just the live length.
 */
export function createShoe(options: ShoeOptions): Shoe {
  const { seed, deckCount } = options;
  if (!Number.isInteger(deckCount) || deckCount <= 0) {
    throw new Error(`deckCount must be a positive integer, got ${deckCount}`);
  }

  const rng = createSeededRng(seed);
  const cards = buildStackedDecks(deckCount);
  shuffleInPlace(cards, rng);

  let dealtCount = 0;

  const draw = (): Card => {
    if (dealtCount >= cards.length) {
      throw new Error("Cannot draw from an empty shoe");
    }
    const card = cards[dealtCount]!;
    dealtCount += 1;
    return card;
  };

  const remaining = (): number => cards.length - dealtCount;

  return { draw, remaining };
}
