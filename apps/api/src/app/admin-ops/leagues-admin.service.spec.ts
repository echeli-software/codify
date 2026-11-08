import type { PrismaService } from '../prisma/prisma.service.js';
import type { GamificationConfigService } from '../gamification/gamification-config.service.js';
import { LeaguesAdminService, percentile } from './leagues-admin.service.js';

const zones = {
  cohortSize: 30,
  promote: 7,
  demote: 5,
  minCohortForDemotion: 5,
};
const config = {
  getMany: jest.fn(async () => ({
    'league.promotionReward': { xp: 50, coins: 100, freeze: 1 },
    'league.rank1Reward': { xp: 25, coins: 50 },
    'league.zones': zones,
  })),
  get: jest.fn(async () => zones),
} as unknown as GamificationConfigService;

describe('percentile', () => {
  it('uses nearest rank', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 95)).toBe(95);
  });
});

describe('LeaguesAdminService', () => {
  it('snapshots the week per tier with rules from config + domain', async () => {
    const prisma = {
      league: {
        findMany: jest.fn(async () => [
          {
            id: 'g2',
            tier: 'GOLD',
            cohortKey: 'b',
            members: [{ weeklyXp: 5 }],
          },
          {
            id: 'b1',
            tier: 'BRONZE',
            cohortKey: 'a',
            members: [{ weeklyXp: 10 }, { weeklyXp: 30 }, { weeklyXp: 20 }],
          },
        ]),
      },
    };
    const svc = new LeaguesAdminService(
      prisma as unknown as PrismaService,
      config,
    );
    const res = await svc.snapshot('2026-11-07T10:00:00Z');
    expect(res.weekStart).toBe('2026-11-02T00:00:00.000Z');
    expect(prisma.league.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { weekStart: new Date('2026-11-02T00:00:00Z') },
      }),
    );
    expect(res.tiers.map((t) => t.tier)).toEqual([
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'DIAMOND',
    ]);
    expect(res.tiers[0]).toEqual({
      tier: 'BRONZE',
      leagues: 1,
      members: 3,
      p50WeeklyXp: 20,
      p95WeeklyXp: 30,
    });
    expect(res.tiers[1]).toMatchObject({
      leagues: 0,
      members: 0,
      p50WeeklyXp: 0,
    });
    expect(res.leagues.map((l) => l.id)).toEqual(['b1', 'g2']);
    expect(res.leagues[0].topWeeklyXp).toBe(30);
    expect(res.rules).toMatchObject({
      cohortCapacity: 30,
      promoteCount: 7,
      demoteCount: 5,
      promotionReward: { xp: 50, coins: 100, freeze: 1 },
    });
  });

  it('ranks league members with projected zones', async () => {
    const members = Array.from({ length: 10 }, (_, i) => ({
      userId: `u${i}`,
      weeklyXp: i === 9 ? 0 : 100 - i * 10,
      finalRank: null,
      promoted: null,
      demoted: null,
      user: { displayName: `User ${i}` },
    }));
    const prisma = {
      league: {
        findUnique: jest.fn(async () => ({
          id: 'l1',
          tier: 'SILVER',
          weekStart: new Date('2026-11-02T00:00:00Z'),
          cohortKey: 'k',
          members: [...members].reverse(),
        })),
      },
    };
    const svc = new LeaguesAdminService(
      prisma as unknown as PrismaService,
      config,
    );
    const res = await svc.detail('l1');
    expect(res.members.map((m) => m.userId)).toEqual(
      members.map((m) => m.userId),
    );
    expect(res.promoteZone).toBe(2);
    expect(res.demoteZone).toBe(2);
    expect(res.members[0]).toMatchObject({
      rank: 1,
      zone: 'promote',
      displayName: 'User 0',
    });
    expect(res.members[2].zone).toBe('stay');
    expect(res.members[9]).toMatchObject({
      rank: 10,
      zone: 'demote',
      weeklyXp: 0,
    });
  });

  it('404s unknown leagues', async () => {
    const prisma = { league: { findUnique: jest.fn(async () => null) } };
    const svc = new LeaguesAdminService(
      prisma as unknown as PrismaService,
      config,
    );
    await expect(svc.detail('x')).rejects.toThrow('League not found');
  });
});
