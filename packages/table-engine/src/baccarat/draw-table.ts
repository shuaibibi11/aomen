/**
 * Baccarat third-card (drawing) rules.
 *
 * These are the fixed rules of the game, not a house option: they are identical
 * at every table and are the correctness core of the whole system. The runtime
 * must call these to decide the deal; it must never "just deal two cards" and
 * claim the hand is complete.
 *
 * The player acts first, then the banker. The banker's action depends on
 * whether the player drew a third card and, if so, its pip value.
 */

/**
 * A natural is a two-card total of 8 or 9. When either side shows a natural the
 * hand ends immediately; no third card is drawn by either side.
 */
export function isNatural(twoCardTotal: number): boolean {
  return twoCardTotal === 8 || twoCardTotal === 9;
}

/**
 * The player draws a third card on a two-card total of 0-5 and stands on 6-7.
 * (Naturals are handled before this is consulted.)
 */
export function playerDrawsThird(playerTotal: number): boolean {
  return playerTotal <= 5;
}

/**
 * Whether the banker draws a third card.
 *
 * @param bankerTotal      the banker's two-card total (0-7; naturals handled earlier)
 * @param playerThirdValue the pip value (0-9) of the player's third card, or
 *                         `null` if the player stood on two cards
 *
 * When the player stood, the banker plays the simple player rule: draw on 0-5,
 * stand on 6-7. When the player drew, the banker follows the standard table:
 *
 *   banker 0-2                         → always draw
 *   banker 3   → draw unless player third is 8
 *   banker 4   → draw when player third is 2-7
 *   banker 5   → draw when player third is 4-7
 *   banker 6   → draw when player third is 6-7
 *   banker 7   → always stand
 */
export function bankerDrawsThird(
  bankerTotal: number,
  playerThirdValue: number | null,
): boolean {
  // Player stood: banker plays the same rule the player did.
  if (playerThirdValue === null) {
    return bankerTotal <= 5;
  }

  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return playerThirdValue !== 8;
    case 4:
      return playerThirdValue >= 2 && playerThirdValue <= 7;
    case 5:
      return playerThirdValue >= 4 && playerThirdValue <= 7;
    case 6:
      return playerThirdValue === 6 || playerThirdValue === 7;
    default:
      // Banker 7 stands; higher totals are naturals handled before this.
      return false;
  }
}
