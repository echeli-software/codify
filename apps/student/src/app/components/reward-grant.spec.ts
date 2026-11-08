import type { LastWeekResult, RewardResult } from '@codify/api-client';
import { leaguePromotionPayload, rewardPayload } from './reward-grant';

const reward = (over: Partial<RewardResult> = {}): RewardResult => ({
  xp: 38,
  coins: 20,
  multiplier: 1.5,
  xpMultiplier: 1.5,
  coinMultiplier: 4,
  breakdown: [
    { source: 'base', xp: 15, coins: 8 },
    { source: 'COURSE_PROMO', multiplier: 4, appliesTo: 'coins' },
    { source: 'QUIZ_PERFECT', xp: 15, coins: 8 },
  ],
  totals: { totalXp: 100, coins: 80, level: 2 },
  levelUp: null,
  streak: {
    currentDays: 7,
    longestDays: 9,
    freezesAvailable: 1,
    extended: true,
    freezesUsed: 1,
    restartedAfterLoss: false,
  },
  streakMilestone: {
    days: 7,
    xp: 0,
    coins: 50,
    item: null,
  },
  coinCap: { requested: 25, pooled: 5, dropped: 0 },
  surpriseBoost: {
    id: 'm1',
    value: 2,
    target: 'XP',
    startsAt: '2026-11-08T10:00:00Z',
    endsAt: '2026-11-08T10:15:00Z',
  },
  questsCompleted: [
    { id: 'qa1', templateId: 't1', title: 'Do 1', xpReward: 0, coinReward: 20 },
  ],
  ...over,
});

describe('rewardPayload', () => {
  it('maps the whole server reward into the orchestrator payload', () => {
    const p = rewardPayload(
      'quizPass',
      reward(),
      [{ id: 'b1', slug: 'first-steps', name: 'First', icon: 'star' }],
      null,
    );
    expect(p.canonical).toMatchObject({ xp: 38, coins: 20, multiplier: 4 });
    expect(p.canonical.breakdown).toHaveLength(3);
    expect(p.totals).toMatchObject({
      totalXp: 100,
      streakDays: 7,
      bestDays: 9,
    });
    expect(p.streakMilestone).toEqual({
      days: 7,
      xp: 0,
      coins: 50,
      item: null,
    });
    expect(p.questsCompleted).toEqual([
      { id: 'qa1', templateId: 't1', title: 'Do 1', xp: 0, coins: 20 },
    ]);
    expect(p.streakChange).toEqual({
      extended: true,
      freezesUsed: 1,
      restartedAfterLoss: false,
    });
    expect(p.coinsPooled).toBe(5);
    expect(p.surpriseBoost).toMatchObject({ value: 2, target: 'XP' });
    expect(p.badgesUnlocked?.[0]).toMatchObject({ slug: 'first-steps' });
  });

  it('tolerates an older reward without the new fields', () => {
    const p = rewardPayload(
      'lessonComplete',
      reward({
        streak: { currentDays: 1, longestDays: 1, freezesAvailable: 0 },
        streakMilestone: undefined,
        coinCap: undefined,
        surpriseBoost: undefined,
        questsCompleted: undefined,
      }),
      undefined,
      null,
    );
    expect(p.streakChange).toBeNull();
    expect(p.streakMilestone).toBeNull();
    expect(p.questsCompleted).toEqual([]);
    expect(p.coinsPooled).toBe(0);
  });
});

describe('leaguePromotionPayload', () => {
  it('is display-only (the rollover already paid it)', () => {
    const lw: LastWeekResult = {
      tier: 'BRONZE',
      newTier: 'SILVER',
      finalRank: 2,
      cohortSize: 30,
      promoted: true,
      demoted: false,
      xpReward: 50,
      coinReward: 100,
      freezeAwarded: true,
      weekStart: '2026-11-02T00:00:00.000Z',
    };
    expect(leaguePromotionPayload(lw)).toEqual({
      kind: 'leaguePromotion',
      canonical: { xp: 50, coins: 100 },
      leaguePromotion: { tier: 'BRONZE', newTier: 'SILVER', rank: 2 },
      displayOnly: true,
    });
  });
});
