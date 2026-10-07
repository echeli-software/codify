import { NotFoundException } from '@nestjs/common';
import { GAMIFICATION_CONFIG_DEFAULTS } from '../gamification/gamification-config.service.js';
import {
  LeaguesService,
  leagueResultCopy,
  weeklyBadgeSlug,
} from './leagues.service.js';
import { LeagueAccumulatorService } from './league-accumulator.service.js';

const config = {
  getMany: async (keys: string[]) =>
    Object.fromEntries(
      keys.map((k) => [
        k,
        GAMIFICATION_CONFIG_DEFAULTS[
          k as keyof typeof GAMIFICATION_CONFIG_DEFAULTS
        ],
      ]),
    ),
  get: async (k: keyof typeof GAMIFICATION_CONFIG_DEFAULTS) =>
    GAMIFICATION_CONFIG_DEFAULTS[k],
};

function setupRollover(memberCount: number) {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    leagueId: 'L1',
    userId: `u${i}`,
    weeklyXp: (memberCount - i) * 10,
    rewardedAt: null as Date | null,
  }));
  const stamped = new Set<string>();
  const userBadges = new Set<string>();
  const tx = {
    leagueMembership: {
      updateMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        if (stamped.has(where.userId)) return { count: 0 };
        stamped.add(where.userId);
        return { count: 1 };
      }),
    },
    userBadge: {
      createMany: jest.fn(async ({ data }: { data: { userId: string }[] }) => {
        const k = data[0].userId;
        if (userBadges.has(k)) return { count: 0 };
        userBadges.add(k);
        return { count: 1 };
      }),
    },
    streak: {
      findUnique: jest.fn(async () => ({ freezesAvailable: 2 })),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    league: {
      findMany: jest.fn(async () => [{ id: 'L1', tier: 'SILVER', members }]),
    },
    badge: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'B1' })),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const gamification = { grantReward: jest.fn(async () => ({})) };
  const push = { sendToUser: jest.fn(async () => ({ sent: 1 })) };
  const svc = new LeaguesService(
    prisma as never,
    gamification as never,
    {} as never,
    config as never,
    push as never,
  );
  return { svc, prisma, tx, gamification, push };
}

describe('LeaguesService.runRollover', () => {
  it('rewards, awards the weekly badge, pushes every member, and is idempotent', async () => {
    const { svc, tx, gamification, push, prisma } = setupRollover(10);
    const res = await svc.runRollover('2026-09-28T00:00:00.000Z');
    // 10 × 7/30 ≈ 2.3 → 2 promote.
    expect(res.promotions).toBe(2);
    expect(res.membersRewarded).toBe(10);
    expect(res.badgesAwarded).toBe(1);
    expect(res.pushesSent).toBe(10);
    expect(gamification.grantReward).toHaveBeenCalledTimes(2);
    expect(gamification.grantReward.mock.calls[0]).toEqual([
      expect.objectContaining({
        userId: 'u0',
        baseXp: 75,
        baseCoins: 150,
        idempotencyKey: 'league:L1:u0',
      }),
      tx,
    ]);
    // Freeze capped at streak.freezeCap (2) — already 2 banked.
    expect(tx.streak.update).toHaveBeenCalledWith({
      where: { userId: 'u0' },
      data: { freezesAvailable: 2 },
    });
    expect(prisma.badge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'league-champion-2026-09',
          isHidden: true,
        }),
      }),
    );
    expect(push.sendToUser).toHaveBeenCalledTimes(10);

    const again = await svc.runRollover('2026-09-28T00:00:00.000Z');
    expect(again.membersRewarded).toBe(0);
    expect(again.pushesSent).toBe(0);
    expect(gamification.grantReward).toHaveBeenCalledTimes(2);
  });

  it('scheduled run is disabled under jest', async () => {
    const { svc, prisma } = setupRollover(3);
    expect(await svc.runScheduledRollover()).toBeNull();
    expect(prisma.league.findMany).not.toHaveBeenCalled();
  });
});

describe('LeaguesService.getLastWeek', () => {
  it('404 before the rollover; maps the stamped membership + ledger rewards', async () => {
    const prisma = {
      leagueMembership: { findFirst: jest.fn(async () => null as unknown) },
      xpEvent: { findUnique: jest.fn(async () => ({ amount: 75 })) },
      coinTransaction: { findUnique: jest.fn(async () => ({ delta: 150 })) },
    };
    const svc = new LeaguesService(
      prisma as never,
      {} as never,
      {} as never,
      config as never,
      {} as never,
    );
    const now = new Date('2026-10-07T12:00:00Z');
    await expect(svc.getLastWeek('u1', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.leagueMembership.findFirst.mockResolvedValueOnce({
      leagueId: 'L1',
      finalRank: 1,
      promoted: true,
      demoted: false,
      league: { tier: 'SILVER', _count: { members: 12 } },
    });
    const res = await svc.getLastWeek('u1', now);
    expect(res).toEqual({
      tier: 'SILVER',
      newTier: 'GOLD',
      finalRank: 1,
      cohortSize: 12,
      promoted: true,
      demoted: false,
      xpReward: 75,
      coinReward: 150,
      freezeAwarded: true,
      weekStart: '2026-09-28T00:00:00.000Z',
    });
    expect(prisma.xpEvent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: 'league:L1:u1' } }),
    );
  });
});

describe('league helpers', () => {
  it('weekly badge rotates monthly', () => {
    expect(weeklyBadgeSlug(new Date('2026-09-28T00:00:00Z'))).toBe(
      'league-champion-2026-09',
    );
  });
  it('localized result copy', () => {
    const r = {
      rank: 1,
      promoted: true,
      demoted: false,
      newTier: 'GOLD' as const,
    };
    expect(leagueResultCopy('pt-BR', 'SILVER', r).title).toContain('Ouro');
    expect(leagueResultCopy('en-US', 'SILVER', r).title).toContain('Gold');
  });
});

describe('LeagueAccumulatorService.ensureMembership', () => {
  it('takes the per-tier advisory lock and re-checks before placing', async () => {
    const calls: string[] = [];
    const tx = {
      leagueMembership: {
        findFirst: jest
          .fn()
          .mockImplementationOnce(async () => (calls.push('check'), null)) // existing
          .mockImplementationOnce(async () => (calls.push('prevTier'), null)) // resolveTier
          .mockImplementationOnce(
            async () => (calls.push('recheck'), { leagueId: 'L9' }),
          ),
        create: jest.fn(),
      },
      $executeRaw: jest.fn(async () => (calls.push('lock'), 1)),
      league: { findMany: jest.fn(), create: jest.fn() },
    };
    const svc = new LeagueAccumulatorService();
    const res = await svc.ensureMembership(tx as never, 'u1');
    expect(res).toEqual({ leagueId: 'L9' });
    expect(calls).toEqual(['check', 'prevTier', 'lock', 'recheck']);
    expect(tx.leagueMembership.create).not.toHaveBeenCalled();
  });
});
