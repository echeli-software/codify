import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GAMIFICATION_CONFIG_DEFAULTS } from '../gamification/gamification-config.service.js';
import { ReferralsService, referralRewardKey } from './referrals.service.js';

type U = {
  id: string;
  createdAt: Date;
  referredById: string | null;
  referralCode: string | null;
};

function setup(users: U[]) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => ({
          ...byId.get(where.id)!,
        }),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          byId.get(where.id) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { referralCode: string } }) =>
          users.find((u) => u.referralCode === where.referralCode) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; referredById?: null; referralCode?: null };
          data: Partial<U>;
        }) => {
          const u = byId.get(where.id)!;
          if ('referredById' in where && u.referredById !== null)
            return { count: 0 };
          if ('referralCode' in where && u.referralCode !== null)
            return { count: 0 };
          Object.assign(u, data);
          return { count: 1 };
        },
      ),
      count: jest.fn(async () => 0),
    },
    $queryRaw: jest.fn(async () => [] as unknown[]),
  };
  const gamification = {
    grantReward: jest.fn(async () => ({ xp: 50, coins: 200 })),
  };
  const config = {
    get: async (k: keyof typeof GAMIFICATION_CONFIG_DEFAULTS) =>
      GAMIFICATION_CONFIG_DEFAULTS[k],
  };
  return {
    svc: new ReferralsService(
      prisma as never,
      gamification as never,
      config as never,
    ),
    prisma,
    gamification,
    byId,
  };
}

const NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('ReferralsService.claim', () => {
  const base = (): U[] => [
    {
      id: 'referrer',
      createdAt: daysAgo(100),
      referredById: null,
      referralCode: 'REF00001',
    },
    {
      id: 'me',
      createdAt: daysAgo(3),
      referredById: null,
      referralCode: 'MINE0001',
    },
  ];

  it('attributes once, then is idempotent for the same code', async () => {
    const { svc, byId } = setup(base());
    expect(await svc.claim('me', ' ref00001 ', NOW)).toEqual({
      status: 'claimed',
    });
    expect(byId.get('me')!.referredById).toBe('referrer');
    expect(await svc.claim('me', 'REF00001', NOW)).toEqual({
      status: 'already_claimed',
    });
  });

  it('rejects a second, different referrer', async () => {
    const users = base();
    users.push({
      id: 'other',
      createdAt: daysAgo(50),
      referredById: null,
      referralCode: 'OTHER001',
    });
    users[1].referredById = 'referrer';
    const { svc } = setup(users);
    await expect(svc.claim('me', 'OTHER001', NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects self, unknown codes and claims after the 14-day window', async () => {
    const users = base();
    const { svc } = setup(users);
    await expect(svc.claim('me', 'MINE0001', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.claim('me', 'NOPE0000', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    users[1].createdAt = daysAgo(15);
    await expect(svc.claim('me', 'REF00001', NOW)).rejects.toThrow(
      /within 14 days/,
    );
  });

  it('rejects circular referrals (A→B→me, me cannot claim A)', async () => {
    const users: U[] = [
      {
        id: 'A',
        createdAt: daysAgo(10),
        referredById: 'B',
        referralCode: 'AAAA0000',
      },
      {
        id: 'B',
        createdAt: daysAgo(10),
        referredById: 'me',
        referralCode: 'BBBB0000',
      },
      {
        id: 'me',
        createdAt: daysAgo(5),
        referredById: null,
        referralCode: 'MINE0001',
      },
    ];
    const { svc } = setup(users);
    await expect(svc.claim('me', 'AAAA0000', NOW)).rejects.toThrow(/Circular/);
  });
});

describe('ReferralsService.getOrCreateCode', () => {
  it('generates a Crockford code once and reuses it', async () => {
    const users: U[] = [
      { id: 'me', createdAt: NOW, referredById: null, referralCode: null },
    ];
    const { svc } = setup(users);
    const code = await svc.getOrCreateCode('me');
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await svc.getOrCreateCode('me')).toBe(code);
  });
});

describe('ReferralsService.grantPendingRewards', () => {
  it('pays each converted referee once with key referral:<refereeId>', async () => {
    const { svc, prisma, gamification } = setup([]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { refereeId: 'r1', referrerId: 'A' },
      { refereeId: 'r2', referrerId: 'A' },
    ]);
    const res = await svc.grantPendingRewards();
    expect(res).toEqual({ candidates: 2, rewarded: 2 });
    expect(gamification.grantReward).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'A',
        baseXp: 50,
        baseCoins: 200,
        refType: 'referral',
        refId: 'r1',
        idempotencyKey: referralRewardKey('r1'),
        flat: true,
      }),
    );
  });

  it('keeps going when one grant fails', async () => {
    const { svc, prisma, gamification } = setup([]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { refereeId: 'r1', referrerId: 'A' },
      { refereeId: 'r2', referrerId: 'B' },
    ]);
    gamification.grantReward.mockRejectedValueOnce(new Error('boom'));
    expect(await svc.grantPendingRewards()).toEqual({
      candidates: 2,
      rewarded: 1,
    });
  });

  it('scheduled run is disabled under jest', async () => {
    const { svc, prisma } = setup([]);
    expect(await svc.runScheduledRewards()).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
