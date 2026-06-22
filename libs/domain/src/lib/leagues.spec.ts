import {
  computeRollover,
  currentWeekStart,
  nextTierAfter,
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
    expect(currentWeekStart(new Date('2026-06-22T00:00:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z');
    expect(currentWeekStart(new Date('2026-06-28T23:59:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });
  it('previousWeekStart is 7 days earlier', () => {
    expect(previousWeekStart(new Date('2026-06-24T00:00:00Z')).toISOString()).toBe('2026-06-15T00:00:00.000Z');
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
    Array.from({ length: n }, (_, i) => ({ userId: `u${String(i).padStart(2, '0')}`, weeklyXp: (n - i) * 10 }));

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

  it('promotion wins over demotion in a tiny cohort', () => {
    const r = computeRollover(members(8), 'GOLD');
    // 8 members: ranks 1-7 promote; rank 8 is in bottom-5 zone but rank>1 demotes.
    expect(r.filter((x) => x.promoted).length).toBe(7);
    expect(r[7].demoted).toBe(true);
    // no member is both promoted and demoted
    expect(r.every((x) => !(x.promoted && x.demoted))).toBe(true);
  });
});
