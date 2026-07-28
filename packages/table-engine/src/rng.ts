/**
 * Seeded pseudo-random number generator.
 *
 * Reproducibility is the requirement: the same seed must always produce the
 * same sequence so a session's shoe can be replayed exactly. This uses a small
 * deterministic generator (mulberry32) fed by a hashed string seed. It is not
 * cryptographically secure, and does not need to be — it only has to be stable
 * and well-distributed for shuffling training decks.
 */

export interface SeededRng {
  /** Next float in the half-open range [0, 1). */
  nextFloat(): number;
  /** Next integer in [0, bound). `bound` must be a positive integer. */
  nextInt(bound: number): number;
}

/**
 * Hash a string seed into a 32-bit unsigned integer (FNV-1a).
 *
 * Different seeds map to different starting states with overwhelming
 * probability, which is what makes distinct seeds diverge.
 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    // 32-bit FNV prime multiply, kept in range with Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Create a seeded RNG. The generator is mulberry32: one 32-bit state word
 * advanced per draw, which is compact, fast and stable across platforms.
 */
export function createSeededRng(seed: string): SeededRng {
  let state = hashSeed(seed);

  const nextFloat = (): number => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (bound: number): number => {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(`nextInt bound must be a positive integer, got ${bound}`);
    }
    return Math.floor(nextFloat() * bound);
  };

  return { nextFloat, nextInt };
}
