import {
  xpForLevel,
  levelFromXp,
  xpToNextLevel,
  levelProgress,
  levelProgressPct,
  tierForLevel,
} from './level.js';

describe('xpForLevel', () => {
  it.each([
    [-5, 0],
    [0, 0],
    [1, 0],
    [2, 125],
    [5, 1100],
    [10, 4725],
    [25, 30600],
    [50, 123725],
  ])('xpForLevel(%i) = %i', (level, expected) => {
    expect(xpForLevel(level)).toBe(expected);
  });

  it('floors fractional levels', () => {
    expect(xpForLevel(2.9)).toBe(xpForLevel(2));
  });

  it('handles non-finite input', () => {
    expect(xpForLevel(NaN)).toBe(0);
    expect(xpForLevel(Infinity)).toBe(0);
  });
});

describe('levelFromXp', () => {
  it('returns 1 for non-positive XP', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(-100)).toBe(1);
    expect(levelFromXp(NaN)).toBe(1);
  });

  it('inverts xpForLevel exactly at thresholds', () => {
    for (const L of [1, 2, 3, 5, 10, 25, 50, 100]) {
      expect(levelFromXp(xpForLevel(L))).toBe(L);
    }
  });

  it('returns the lower level just below a threshold', () => {
    expect(levelFromXp(xpForLevel(5) - 1)).toBe(4);
    expect(levelFromXp(xpForLevel(10) - 1)).toBe(9);
  });

  it('returns the same level partway through', () => {
    const mid = Math.floor((xpForLevel(5) + xpForLevel(6)) / 2);
    expect(levelFromXp(mid)).toBe(5);
  });
});

describe('xpToNextLevel', () => {
  it('returns the gap to the next threshold', () => {
    expect(xpToNextLevel(0)).toBe(xpForLevel(2));
    expect(xpToNextLevel(xpForLevel(5))).toBe(xpForLevel(6) - xpForLevel(5));
  });

  it('decreases monotonically within a level', () => {
    const a = xpToNextLevel(xpForLevel(5));
    const b = xpToNextLevel(xpForLevel(5) + 100);
    expect(b).toBeLessThan(a);
  });
});

describe('levelProgress', () => {
  it('returns 0 at the start of a level', () => {
    expect(levelProgress(xpForLevel(5))).toBe(0);
  });

  it('returns ~1 just before the next threshold', () => {
    const xp = xpForLevel(6) - 1;
    expect(levelProgress(xp)).toBeGreaterThan(0.99);
    expect(levelProgress(xp)).toBeLessThan(1);
  });

  it('clamps to [0, 1]', () => {
    expect(levelProgress(-100)).toBe(0);
    expect(levelProgress(0)).toBe(0);
  });

  it('levelProgressPct rounds', () => {
    const xp = xpForLevel(5) + Math.floor((xpForLevel(6) - xpForLevel(5)) / 2);
    expect(levelProgressPct(xp)).toBe(50);
  });
});

describe('tierForLevel', () => {
  it.each([
    [1, 'BRONZE'],
    [4, 'BRONZE'],
    [5, 'SILVER'],
    [9, 'SILVER'],
    [10, 'GOLD'],
    [19, 'GOLD'],
    [20, 'PLATINUM'],
    [29, 'PLATINUM'],
    [30, 'DIAMOND'],
    [39, 'DIAMOND'],
    [40, 'MYTHIC'],
    [49, 'MYTHIC'],
    [50, 'PRESTIGE'],
    [999, 'PRESTIGE'],
  ])('tierForLevel(%i) = %s', (level, expected) => {
    expect(tierForLevel(level)).toBe(expected);
  });
});
