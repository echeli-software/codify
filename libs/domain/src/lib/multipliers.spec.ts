import {
  applyMultiplier,
  resolveMultiplier,
  type MultiplierRule,
} from './multipliers.js';

const NOW = new Date('2026-06-21T12:00:00Z');

const rule = (over: Partial<MultiplierRule>): MultiplierRule => ({
  id: over.id ?? Math.random().toString(36),
  kind: over.kind ?? 'CAMPAIGN',
  target: over.target ?? 'BOTH',
  value: over.value ?? 2,
  ...over,
});

describe('resolveMultiplier', () => {
  it('free user with no rules → 1x, no components', () => {
    const r = resolveMultiplier({ multipliers: [], isPremium: false, now: NOW });
    expect(r.xp.effective).toBe(1);
    expect(r.coins.effective).toBe(1);
    expect(r.xp.components).toEqual([]);
  });

  it('docs §3 example: premium 2 × streak 1.5 × lesson promo 4 × campaign 2 = 24', () => {
    const multipliers: MultiplierRule[] = [
      rule({ kind: 'PREMIUM_DEFAULT', value: 2 }),
      rule({ kind: 'STREAK_TIER', value: 1.5, streakDaysMin: 30 }),
      rule({ kind: 'STREAK_TIER', value: 1.1, streakDaysMin: 7 }), // lower tier, ignored
      rule({ kind: 'LESSON_PROMO', value: 4, lessonId: 'L1' }),
      rule({ kind: 'COURSE_PROMO', value: 3, courseId: 'C1' }), // lesson promo wins
      rule({ kind: 'CAMPAIGN', value: 2 }),
    ];
    const r = resolveMultiplier({
      multipliers,
      isPremium: true,
      courseId: 'C1',
      lessonId: 'L1',
      streakDays: 30,
      now: NOW,
    });
    expect(r.xp.effective).toBe(24);
    expect(r.coins.effective).toBe(24);
    // 4 components: premium, streak, lesson promo, campaign (course promo excluded)
    expect(r.xp.components.map((c) => c.kind).sort()).toEqual(
      ['CAMPAIGN', 'LESSON_PROMO', 'PREMIUM_DEFAULT', 'STREAK_TIER'],
    );
    expect(r.xp.components.find((c) => c.kind === 'LESSON_PROMO')?.value).toBe(4);
  });

  it('free user ignores PREMIUM_DEFAULT', () => {
    const r = resolveMultiplier({
      multipliers: [rule({ kind: 'PREMIUM_DEFAULT', value: 2 })],
      isPremium: false,
      now: NOW,
    });
    expect(r.xp.effective).toBe(1);
  });

  it('course promo applies when no lesson promo matches', () => {
    const r = resolveMultiplier({
      multipliers: [rule({ kind: 'COURSE_PROMO', value: 3, courseId: 'C1' })],
      isPremium: false,
      courseId: 'C1',
      lessonId: 'L1',
      now: NOW,
    });
    expect(r.coins.effective).toBe(3);
  });

  it('respects target: XP-only promo does not boost coins', () => {
    const r = resolveMultiplier({
      multipliers: [rule({ kind: 'CAMPAIGN', value: 3, target: 'XP' })],
      isPremium: false,
      now: NOW,
    });
    expect(r.xp.effective).toBe(3);
    expect(r.coins.effective).toBe(1);
  });

  it('ignores rules outside their time window', () => {
    const r = resolveMultiplier({
      multipliers: [
        rule({ kind: 'CAMPAIGN', value: 5, startsAt: '2026-07-01T00:00:00Z' }), // future
        rule({ kind: 'PREMIUM_DEFAULT', value: 2, endsAt: '2026-01-01T00:00:00Z' }), // past
      ],
      isPremium: true,
      now: NOW,
    });
    expect(r.xp.effective).toBe(1);
  });

  it('caps the effective multiplier at 30x and flags it', () => {
    const r = resolveMultiplier({
      multipliers: [
        rule({ kind: 'PREMIUM_DEFAULT', value: 3 }),
        rule({ kind: 'LESSON_PROMO', value: 5, lessonId: 'L1' }),
        rule({ kind: 'CAMPAIGN', value: 5 }),
      ],
      isPremium: true,
      lessonId: 'L1',
      now: NOW,
    });
    // 3 × 5 × 5 = 75 → capped to 30
    expect(r.xp.effective).toBe(30);
    expect(r.xp.capped).toBe(true);
  });

  it('highest qualifying streak tier wins; below-threshold tiers excluded', () => {
    const r = resolveMultiplier({
      multipliers: [
        rule({ kind: 'STREAK_TIER', value: 1.5, streakDaysMin: 30 }),
        rule({ kind: 'STREAK_TIER', value: 2, streakDaysMin: 365 }), // not reached
      ],
      isPremium: false,
      streakDays: 45,
      now: NOW,
    });
    expect(r.xp.effective).toBe(1.5);
  });
});

describe('applyMultiplier', () => {
  it('rounds base × effective to an integer', () => {
    expect(applyMultiplier(10, 2.5)).toBe(25);
    expect(applyMultiplier(5, 1.1)).toBe(6); // 5.5 → 6
    expect(applyMultiplier(8, 1)).toBe(8);
  });
});
