import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FriendsService } from '../leagues/friends.service.js';
import { LeaguesService } from '../leagues/leagues.service.js';
import { ProfileService } from '../leagues/profile.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ageGroupWhere, knownAdultWhere } from './age-policy.js';
import { UsersService } from './users.service.js';

/**
 * docs/14 "Minors": the 12–17 defaults (and the fail-closed treatment of
 * accounts with no date of birth) across profile, discovery, the friends
 * activity feed, opt-ins and the admin age-group filter.
 */

const ADULT = new Date('1990-01-01T00:00:00Z');
const MINOR = new Date('2011-06-15T00:00:00Z'); // 15 in Nov 2026

const meRow = (birthDate: Date | null) => ({
  id: 'u1',
  email: 's@codify.local',
  displayName: 'S',
  role: 'STUDENT',
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  marketingEmailOptIn: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  onboardedAt: null,
  lastSeenAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  totalXp: 0,
  coins: 0,
  petName: null,
  activityFeedOptIn: false,
  theme: null,
  onboardingGoal: null,
  country: null,
  birthDate,
});

function usersSetup(birthDate: Date | null) {
  const prisma = {
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    user: {
      findUnique: jest.fn(async () => meRow(birthDate)),
      findFirst: jest.fn(async () => meRow(birthDate)),
      update: jest.fn(async () => meRow(birthDate)),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [] as unknown[]),
      count: jest.fn(async () => 0),
    },
    userItem: { findFirst: jest.fn(async (): Promise<unknown> => null) },
  };
  return {
    svc: new UsersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('PATCH /me opt-ins (activity feed, marketing email)', () => {
  it.each([
    ['a minor', MINOR],
    ['an account with no date of birth', null],
  ])('refuses opting in for %s', async (_label, birthDate) => {
    const { svc, prisma } = usersSetup(birthDate);
    for (const body of [
      { activityFeedOptIn: true },
      { marketingEmailOptIn: true },
    ]) {
      const err = await svc.update('u1', body).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.response).toMatchObject({
        code: 'AGE_RESTRICTED',
        setting: Object.keys(body)[0],
      });
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lets a minor turn them off and change anything else', async () => {
    const { svc, prisma } = usersSetup(MINOR);
    await svc.update('u1', {
      activityFeedOptIn: false,
      marketingEmailOptIn: false,
      displayName: 'Bia',
    });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('lets an adult opt in', async () => {
    const { svc, prisma } = usersSetup(ADULT);
    await svc.update('u1', {
      activityFeedOptIn: true,
      marketingEmailOptIn: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activityFeedOptIn: true, marketingEmailOptIn: true },
      }),
    );
  });
});

describe('GET /me and the staff detail', () => {
  it('returns the user their own date and age group', async () => {
    const { svc } = usersSetup(MINOR);
    await expect(svc.getById('u1')).resolves.toMatchObject({
      birthDate: '2011-06-15',
      ageGroup: 'minor',
    });
    await expect(usersSetup(null).svc.getById('u1')).resolves.toMatchObject({
      birthDate: null,
      ageGroup: null,
    });
  });

  it('shows staff the age group but never the date', async () => {
    const detail = await usersSetup(ADULT).svc.getDetailForAdmin('u1');
    expect(detail.ageGroup).toBe('adult');
    expect('birthDate' in detail).toBe(false);
  });
});

describe('GET /users?ageGroup= (admin filter)', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  it('builds minor / adult / none filters on the UTC day', () => {
    const cutoff = new Date('2008-11-08T00:00:00Z');
    expect(ageGroupWhere('adult', now)).toEqual({
      birthDate: { lte: cutoff },
    });
    expect(ageGroupWhere('minor', now)).toEqual({ birthDate: { gt: cutoff } });
    expect(ageGroupWhere('none', now)).toEqual({ birthDate: null });
    expect(ageGroupWhere(undefined, now)).toEqual({});
  });

  it('is applied by listForAdmin, and items carry the age group', async () => {
    const { svc, prisma } = usersSetup(null);
    prisma.user.findMany.mockResolvedValueOnce([
      { ...meRow(MINOR), lastSeenAt: null },
    ]);
    const res = await svc.listForAdmin({
      skip: 0,
      take: 20,
      ageGroup: 'minor',
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ birthDate: { gt: expect.any(Date) } }),
      }),
    );
    expect(res.items[0].ageGroup).toBe('minor');
  });
});

describe('Public profile visibility (GET /users/:id/profile)', () => {
  function profileSetup(birthDate: Date | null, friends = false) {
    const prisma = {
      user: {
        findFirst: jest.fn(async () => ({
          id: 'kid',
          displayName: 'Kid',
          totalXp: 120,
          avatarConfig: null,
          petName: null,
          timezone: 'America/Sao_Paulo',
          birthDate,
        })),
      },
      friendship: {
        findUnique: jest.fn(async () => (friends ? { userAId: 'kid' } : null)),
        count: jest.fn(async () => 0),
      },
      equippedItem: { findMany: jest.fn(async () => [] as unknown[]) },
      userBadge: { findMany: jest.fn(async () => [] as unknown[]) },
      progress: { count: jest.fn(async () => 3) },
      streak: { findUnique: jest.fn(async () => null) },
      userItem: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
      },
      asset: { findMany: jest.fn(async () => [] as unknown[]) },
      $queryRaw: jest.fn(async () => [] as unknown[]),
    };
    return { svc: new ProfileService(prisma as never), prisma };
  }

  it('hides a minor from non-friends with the unknown-user 404', async () => {
    const { svc, prisma } = profileSetup(MINOR);
    const err = await svc.get('kid', 'stranger').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('User not found');
    expect(prisma.friendship.findUnique).toHaveBeenCalledWith({
      where: { userAId_userBId: { userAId: 'kid', userBId: 'stranger' } },
      select: { userAId: true },
    });
  });

  it('hides an account with no date of birth the same way (fail closed)', async () => {
    await expect(
      profileSetup(null).svc.get('kid', 'stranger'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows a minor to friends and to themselves', async () => {
    await expect(
      profileSetup(MINOR, true).svc.get('kid', 'buddy'),
    ).resolves.toMatchObject({ userId: 'kid', displayName: 'Kid' });
    const self = profileSetup(MINOR);
    await expect(self.svc.get('kid', 'kid')).resolves.toMatchObject({
      userId: 'kid',
    });
    expect(self.prisma.friendship.findUnique).not.toHaveBeenCalled();
  });

  it('keeps adult profiles public', async () => {
    const { svc, prisma } = profileSetup(ADULT);
    await expect(svc.get('kid', 'stranger')).resolves.toMatchObject({
      userId: 'kid',
    });
    expect(prisma.friendship.findUnique).not.toHaveBeenCalled();
  });
});

describe('Friends activity feed', () => {
  it('only shows friends who are known adults, even if a minor opted in', async () => {
    const prisma = {
      friendship: {
        findMany: jest.fn(async () => [{ userAId: 'me', userBId: 'kid' }]),
      },
      user: { findMany: jest.fn(async () => [] as unknown[]) },
    };
    const svc = new FriendsService(prisma as never, {} as never, {} as never);
    await expect(svc.activity('me')).resolves.toEqual([]);
    const where = (prisma.user.findMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      activityFeedOptIn: true,
      birthDate: knownAdultWhere().birthDate,
    });
  });
});

describe('League standings', () => {
  it('names every member but links profiles only for adults, friends and me', async () => {
    const member = (id: string, birthDate: Date | null, xp: number) => ({
      userId: id,
      weeklyXp: xp,
      user: {
        id,
        displayName: id,
        totalXp: 0,
        avatarConfig: null,
        birthDate,
        timezone: 'UTC',
      },
    });
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})),
      leagueMembership: {
        findFirst: jest.fn(async () => ({
          leagueId: 'L',
          league: { tier: 'BRONZE' },
        })),
        findMany: jest.fn(async () => [
          member('me', MINOR, 50),
          member('adult', ADULT, 40),
          member('kidFriend', MINOR, 30),
          member('kid', MINOR, 20),
          member('unknown', null, 10),
        ]),
      },
      friendship: {
        findMany: jest.fn(async () => [
          { userAId: 'kidFriend', userBId: 'me' },
        ]),
      },
      equippedItem: { findMany: jest.fn(async () => [] as unknown[]) },
      asset: { findMany: jest.fn(async () => [] as unknown[]) },
    };
    const svc = new LeaguesService(
      prisma as never,
      {} as never,
      { ensureMembership: jest.fn(async () => undefined) } as never,
      { get: jest.fn(async () => undefined) } as never,
      {} as never,
    );
    const res = await svc.getCurrent('me');
    expect(
      Object.fromEntries(res.members.map((m) => [m.userId, m.profileVisible])),
    ).toEqual({
      me: true,
      adult: true,
      kidFriend: true,
      kid: false,
      unknown: false,
    });
    expect(res.members.map((m) => m.displayName)).toEqual([
      'me',
      'adult',
      'kidFriend',
      'kid',
      'unknown',
    ]);
  });
});
