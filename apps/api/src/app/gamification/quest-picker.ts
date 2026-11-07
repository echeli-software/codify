/**
 * Deterministic weighted daily-quest picker (docs/07 §8): one quest per
 * difficulty band (easy / medium / hard) where the band has candidates,
 * weighted by `QuestTemplate.weight`, then filled up to `count` from the
 * remaining pool. Seeded by `userId + local date`, so the same user gets the
 * same picks all day (a retried/raced assignment is a no-op) while different
 * users — and different days — get different mixes.
 */

export interface PickableTemplate {
  id: string;
  difficulty: number;
  /** Relative draw weight; ≤ 0 never drawn. Missing = 1. */
  weight?: number | null;
}

/** xmur3 string hash → 32-bit seed. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 PRNG → floats in [0, 1). */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightOf(t: PickableTemplate): number {
  const w = t.weight ?? 1;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

function drawWeighted<T extends PickableTemplate>(
  pool: T[],
  rand: () => number,
): T | null {
  const total = pool.reduce((s, t) => s + weightOf(t), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const t of pool) {
    r -= weightOf(t);
    if (weightOf(t) > 0 && r < 0) return t;
  }
  // Floating-point edge: return the last drawable template.
  return [...pool].reverse().find((t) => weightOf(t) > 0) ?? null;
}

export function pickDailyQuests<T extends PickableTemplate>(
  templates: T[],
  seed: string,
  count: number,
): T[] {
  const rand = seededRandom(seed);
  // Stable input order so the same seed always yields the same picks.
  const pool = [...templates]
    .filter((t) => weightOf(t) > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const picks: T[] = [];
  const used = new Set<string>();

  for (const band of [1, 2, 3]) {
    if (picks.length >= count) break;
    const t = drawWeighted(
      pool.filter((x) => x.difficulty === band && !used.has(x.id)),
      rand,
    );
    if (t) {
      picks.push(t);
      used.add(t.id);
    }
  }
  while (picks.length < count) {
    const t = drawWeighted(
      pool.filter((x) => !used.has(x.id)),
      rand,
    );
    if (!t) break;
    picks.push(t);
    used.add(t.id);
  }
  return picks.sort((a, b) => a.difficulty - b.difficulty);
}
