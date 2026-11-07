import {
  computeRollover,
  currentWeekStart,
  demoteZoneSize,
  nextTierAfter,
  promoteZoneSize,
  previousWeekStart,
  tierDown,
  tierUp,
  type RollMember,
} from './leagues.js';

describe('week boundaries', () => {
  it('currentWeekStart is the UTC Monday 00:00', () => {
    // 2026-06-24 is a Wednesday.
    const ws = currentWeekStart(new Date('2026-06-24T15:30:00Z'));
    expect(ws.toISOString()).toBe('2026-06-22T00:00:00.000Z'); // Monday
    expect(ws.getUTCDay()).toBe(1);
  });
  it('Monday maps to itself; Sunday maps back to that Monday', () => {
    expect(
      currentWeekStart(new Date('2026-06-22T00:00:00Z')).toISOString(),
    ).toBe('2026-06-22T00:00:00.000Z');
    expect(
      currentWeekStart(new Date('2026-06-28T23:59:00Z')).toISOString(),
    ).toBe('2026-06-22T00:00:00.000Z');
  });
  it('previousWeekStart is 7 days earlier', () => {
    expect(
      previousWeekStart(new Date('2026-06-24T00:00:00Z')).toISOString(),
    ).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('tier transitions', () => {
  it('clamps at the ends', () => {
    expect(tierUp('DIAMOND')).toBe('DIAMOND');
    expect(tierDown('BRONZE')).toBe('BRONZE');
    expect(tierUp('BRONZE')).toBe('SILVER');
    expect(tierDown('DIAMOND')).toBe('PLATINUM');
  });
  it('nextTierAfter applies promotion/demotion', () => {
    expect(nextTierAfter('GOLD', true, false)).toBe('PLATINUM');
    expect(nextTierAfter('GOLD', false, true)).toBe('SILVER');
    expect(nextTierAfter('GOLD', false, false)).toBe('GOLD');
  });
});

describe('computeRollover', () => {
  const members = (n: number): RollMember[] =>
    Array.from({ length: n }, (_, i) => ({
      userId: `u${String(i).padStart(2, '0')}`,
      weeklyXp: (n - i) * 10,
    }));

  it('ranks by weekly XP descending', () => {
    const r = computeRollover(members(20), 'GOLD');
    expect(r[0].rank).toBe(1);
    expect(r[0].userId).toBe('u00'); // highest xp
    expect(r[19].rank).toBe(20);
  });

  it('top 7 promote, bottom 5 demote (Gold)', () => {
    const r = computeRollover(members(30), 'GOLD');
    expect(r.filter((x) => x.promoted).length).toBe(7);
    expect(r.filter((x) => x.demoted).length).toBe(5);
    expect(r[0].newTier).toBe('PLATINUM');
    expect(r[29].newTier).toBe('SILVER');
    expect(r[15].newTier).toBe('GOLD'); // mid holds
  });

  it('Bronze never demotes', () => {
    const r = computeRollover(members(30), 'BRONZE');
    expect(r.some((x) => x.demoted)).toBe(false);
    expect(r[29].newTier).toBe('BRONZE');
  });

  it('Diamond never promotes (but #1 still gets the badge + bonus)', () => {
    const r = computeRollover(members(30), 'DIAMOND');
    expect(r.some((x) => x.promoted)).toBe(false);
    expect(r[0].awardWeeklyBadge).toBe(true);
    expect(r[0].rewardXp).toBe(25); // rank-1 bonus only, no promotion
    expect(r[0].newTier).toBe('DIAMOND');
  });

  it('promotion + rank-1 rewards stack for the winner', () => {
    const r = computeRollover(members(30), 'SILVER');
    expect(r[0].promoted).toBe(true);
    expect(r[0].rewardXp).toBe(75); // 50 promo + 25 rank1
    expect(r[0].rewardCoins).toBe(150); // 100 + 50
    expect(r[0].rewardFreeze).toBe(1);
    expect(r[0].awardWeeklyBadge).toBe(true);
    // a promoted non-winner gets promotion reward only
    expect(r[1].rewardXp).toBe(50);
    expect(r[1].awardWeeklyBadge).toBe(false);
  });

  it('small cohorts scale the zones instead of promoting everyone', () => {
    const r = computeRollover(members(8), 'GOLD');
    // 8 × 7/30 ≈ 1.9 → 2 promote; 8 × 5/30 ≈ 1.3 → 1 demotes.
    expect(r.filter((x) => x.promoted).map((x) => x.rank)).toEqual([1, 2]);
    expect(r.filter((x) => x.demoted).map((x) => x.rank)).toEqual([8]);
    expect(r.every((x) => !(x.promoted && x.demoted))).toBe(true);
  });

  it('a solo cohort neither promotes nor demotes (but #1 bonus applies)', () => {
    const r = computeRollover(members(1), 'GOLD');
    expect(r[0].promoted).toBe(false);
    expect(r[0].demoted).toBe(false);
    expect(r[0].awardWeeklyBadge).toBe(true);
  });

  it('members with zero weekly XP never promote or win', () => {
    const r = computeRollover(
      [
        { userId: 'a', weeklyXp: 0 },
        { userId: 'b', weeklyXp: 0 },
        { userId: 'c', weeklyXp: 0 },
      ],
      'SILVER',
    );
    expect(r.some((x) => x.promoted || x.awardWeeklyBadge)).toBe(false);
  });

  it('uses overridden reward amounts', () => {
    const r = computeRollover(members(30), 'SILVER', {
      promotion: { xp: 1, coins: 2, freeze: 0 },
      rank1: { xp: 10, coins: 20 },
    });
    expect(r[0].rewardXp).toBe(11);
    expect(r[0].rewardCoins).toBe(22);
    expect(r[0].rewardFreeze).toBe(0);
  });
});

describe('zone sizes (docs/07 §9 ratios scaled to cohort size)', () => {
  it('a full cohort gets exactly the spec numbers', () => {
    expect(promoteZoneSize(30, 'GOLD')).toBe(7);
    expect(demoteZoneSize(30, 'GOLD')).toBe(5);
  });
  it('never promotes everyone; at least one when n ≥ 2', () => {
    for (let n = 1; n <= 40; n++) {
      const p = promoteZoneSize(n, 'GOLD');
      expect(p).toBeLessThan(Math.max(n, 1));
      if (n >= 2) expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(7);
    }
  });
  it('demotes only when n ≥ 5 and never overlaps promotion', () => {
    for (let n = 1; n <= 40; n++) {
      const d = demoteZoneSize(n, 'GOLD');
      if (n < 5) expect(d).toBe(0);
      else expect(d).toBeGreaterThanOrEqual(1);
      expect(d + promoteZoneSize(n, 'GOLD')).toBeLessThanOrEqual(n);
      expect(d).toBeLessThanOrEqual(5);
    }
  });
  it('tier ends', () => {
    expect(promoteZoneSize(30, 'DIAMOND')).toBe(0);
    expect(demoteZoneSize(30, 'BRONZE')).toBe(0);
  });
});
