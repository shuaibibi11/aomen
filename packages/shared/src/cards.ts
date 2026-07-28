/**
 * Playing cards and baccarat card values.
 *
 * A shoe is dealt from a standard 52-card deck design, but baccarat only cares
 * about a card's point value, not its suit. The value rules are fixed by the
 * game: aces are 1, pip cards are their face number, and tens and court cards
 * are worth zero.
 */

export const SUITS = ["spade", "heart", "diamond", "club"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

/** Cards in one standard deck: 13 ranks across 4 suits. */
export const CARDS_PER_DECK = RANKS.length * SUITS.length;

/** Decks in a standard baccarat shoe. */
export const DECKS_PER_SHOE = 8;

/** Cards in a full eight-deck baccarat shoe. */
export const CARDS_PER_SHOE = CARDS_PER_DECK * DECKS_PER_SHOE;

/**
 * Baccarat point value of a single card.
 *
 *   A            → 1
 *   2..9         → face value
 *   10, J, Q, K  → 0
 *
 * The suit never affects the value.
 */
export function baccaratCardValue(card: Card): number {
  switch (card.rank) {
    case "A":
      return 1;
    case "10":
    case "J":
    case "Q":
    case "K":
      return 0;
    default:
      return Number(card.rank);
  }
}

/**
 * Baccarat total of a hand: the sum of card values modulo 10.
 *
 * This is what makes 9 + 8 = 7 rather than 17 — only the last digit counts.
 */
export function baccaratHandTotal(cards: readonly Card[]): number {
  const sum = cards.reduce((runningTotal, card) => runningTotal + baccaratCardValue(card), 0);
  return sum % 10;
}
