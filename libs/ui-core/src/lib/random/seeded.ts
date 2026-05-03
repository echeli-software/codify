/**
 * Seeded pseudo-RNG (Mulberry32). Same seed → same sequence. Used for
 * deterministic animations (replay-on-demand) and reproducible tests.
 *
 * NOT cryptographically secure. For chest-drop RNG and anything user-trust
 * sensitive, use Web Crypto / Node crypto on the server.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an element deterministically given a seed. */
export function pickSeeded<T>(items: readonly T[], seed: number): T {
  if (items.length === 0) throw new Error('pickSeeded: empty array');
  const r = mulberry32(seed)();
  return items[Math.floor(r * items.length)]!;
}
