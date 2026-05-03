/**
 * Level math. Pure, deterministic. The XP curve is documented in
 * docs/07-gamification.md §4. Every public function in this module is
 * load-bearing — UI shows level + progress everywhere, server credits use
 * the same numbers — so this is the canonical implementation. Do not branch.
 */

/**
 * Cumulative XP required to reach `level`. Level 1 starts at 0 XP.
 * Curve: triangle-number-style growth — `50·(L-1)·L + 25·(L-1)`.
 *
 * Sample:
 *   level 1   → 0
 *   level 2   → 125
 *   level 5   → 1100
 *   level 10  → 4725
 *   level 25  → 30600
 *   level 50  → 123725
 */
export function xpForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  const L = Math.floor(level);
  if (L <= 1) return 0;
  return Math.round(50 * (L - 1) * L + 25 * (L - 1));
}

/**
 * Inverse of `xpForLevel`. Given total XP, return the highest level the
 * user qualifies for. Always ≥ 1.
 */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  // Binary search — bounded above by a generous ceiling. Even prestige
  // players in our spec stay well under 10_000.
  let lo = 1;
  let hi = 10_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (xpForLevel(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** XP remaining to reach the next level. Returns 0 if at or beyond max. */
export function xpToNextLevel(xp: number): number {
  const level = levelFromXp(xp);
  const next = xpForLevel(level + 1);
  return Math.max(0, next - xp);
}

/**
 * Progress within the current level, as a value in [0, 1].
 * 0 = just leveled up; 1 = about to level up.
 */
export function levelProgress(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  if (next === base) return 1;
  const ratio = (xp - base) / (next - base);
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

/** Convenience for UI: 0–100 percent. */
export function levelProgressPct(xp: number): number {
  return Math.round(levelProgress(xp) * 100);
}

/**
 * Visual tier per level — drives ring colors and prestige treatment.
 * Tier rolls every 5 levels through Mythic, then enters prestige rings.
 */
export type LevelTier =
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'DIAMOND'
  | 'MYTHIC'
  | 'PRESTIGE';

export function tierForLevel(level: number): LevelTier {
  if (!Number.isFinite(level) || level < 1) return 'BRONZE';
  if (level >= 50) return 'PRESTIGE';
  if (level >= 40) return 'MYTHIC';
  if (level >= 30) return 'DIAMOND';
  if (level >= 20) return 'PLATINUM';
  if (level >= 10) return 'GOLD';
  if (level >= 5) return 'SILVER';
  return 'BRONZE';
}
