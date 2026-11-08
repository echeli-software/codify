import { ForbiddenException } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { LeaguesService } from './leagues.service.js';
import { coursesCompleted, contentTitles } from './learner-stats.js';

function friendsSetup() {
  const prisma = {
    friendship: {
      findMany: jest.fn(async () => [{ userAId: 'me', userBId: 'f1' }]),
    },
    user: {
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id) => ({
          id,
          displayName: id.toUpperCase(),
          totalXp: id === 'me' ? 0 : 500,
        })),
      ),
    },
    streak: {
      findMany: jest.fn(async () => [
        { userId: 'f1', currentDays: 4, longestDays: 9 },
      ]),
    },
    progress: {
      groupBy: jest.fn(async () => [{ userId: 'f1', _count: { _all: 7 } }]),
      findMany: jest.fn(async () => [] as unknown[]),
    },
    userBadge: {
      groupBy: jest.fn(async () => [{ userId: 'me', _count: { _all: 2 } }]),
      findMany: jest.fn(async () => [] as unknown[]),
    },
    leagueMembership: {
      findMany: jest.fn(async () => [{ userId: 'me', weeklyXp: 40 }]),
    },
    contentTranslation: { findMany: jest.fn(async () => [] as unknown[]) },
    $queryRaw: jest.fn(async () => [{ userId: 'f1', n: 1 }]),
  };
  const svc = new FriendsService(prisma as never, {} as never, {} as never);
  return { svc, prisma };
}

describe('FriendsService.compare (docs/05 Friends)', () => {
  it('returns both sides of the comparison', async () => {
    const { svc } = friendsSetup();
    const res = await svc.compare('me', 'f1');
    expect(res.me).toEqual(
      expect.objectContaining({
        userId: 'me',
        weeklyXp: 40,
        badges: 2,
        lessonsCompleted: 0,
        coursesCompleted: 0,
      }),
    );
    expect(res.friend).toEqual(
      expect.objectContaining({
        displayName: 'F1',
        streakDays: 4,
        longestStreak: 9,
        lessonsCompleted: 7,
        coursesCompleted: 1,
        totalXp: 500,
      }),
    );
  });

  it('refuses non-friends and yourself', async () => {
    const { svc } = friendsSetup();
    await expect(svc.compare('me', 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.compare('me', 'me')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('FriendsService.activity (docs/10 §5)', () => {
  it('only queries friends who opted in', async () => {
    const { svc, prisma } = friendsSetup();
    prisma.user.findMany.mockResolvedValueOnce([]);
    await expect(svc.activity('me')).resolves.toEqual([]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ activityFeedOptIn: true }),
      }),
    );
    expect(prisma.progress.findMany).not.toHaveBeenCalled();
  });

  it('merges lessons and badges newest first', async () => {
    const { svc, prisma } = friendsSetup();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'f1', displayName: 'Ana', totalXp: 0 },
    ]);
    prisma.progress.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        userId: 'f1',
        lessonId: 'l1',
        completedAt: new Date('2026-01-02T00:00:00Z'),
        lesson: { module: { course: { id: 'c1', sourceLocale: 'pt-BR' } } },
      },
    ]);
    prisma.userBadge.findMany.mockResolvedValueOnce([
      {
        userId: 'f1',
        badgeId: 'b1',
        awardedAt: new Date('2026-01-03T00:00:00Z'),
        badge: { name: 'Streak 7', iconName: 'flame' },
      },
    ]);
    prisma.contentTranslation.findMany
      .mockResolvedValueOnce([
        { entityId: 'l1', locale: 'pt-BR', value: 'Aula' },
      ])
      .mockResolvedValueOnce([
        { entityId: 'c1', locale: 'en-US', value: 'JS' },
      ]);
    const feed = await svc.activity('me');
    expect(feed.map((e) => e.kind)).toEqual([
      'BADGE_UNLOCKED',
      'LESSON_COMPLETED',
    ]);
    expect(feed[1]).toEqual(
      expect.objectContaining({
        displayName: 'Ana',
        lessonTitle: 'Aula',
        courseTitle: 'JS',
      }),
    );
    expect(feed[0].badgeName).toBe('Streak 7');
  });

  it('is empty without friends', async () => {
    const { svc, prisma } = friendsSetup();
    prisma.friendship.findMany.mockResolvedValueOnce([]);
    await expect(svc.activity('me')).resolves.toEqual([]);
  });
});

describe('LeaguesService.getHistory', () => {
  it('maps finished weeks with the resulting tier', async () => {
    const prisma = {
      leagueMembership: {
        findMany: jest.fn(async () => [
          {
            weeklyXp: 120,
            finalRank: 2,
            promoted: true,
            demoted: false,
            league: {
              tier: 'BRONZE',
              weekStart: new Date('2026-01-05T00:00:00Z'),
              _count: { members: 30 },
            },
          },
        ]),
      },
    };
    const svc = new LeaguesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const res = await svc.getHistory('u1', 500);
    expect(res).toEqual([
      {
        weekStart: '2026-01-05T00:00:00.000Z',
        tier: 'BRONZE',
        newTier: 'SILVER',
        finalRank: 2,
        cohortSize: 30,
        weeklyXp: 120,
        promoted: true,
        demoted: false,
      },
    ]);
    expect(prisma.leagueMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 52 }),
    );
  });
});

describe('learner stats helpers', () => {
  it('skips the query for no users', async () => {
    const q = jest.fn();
    await expect(
      coursesCompleted({ $queryRaw: q } as never, []),
    ).resolves.toEqual(new Map());
    expect(q).not.toHaveBeenCalled();
    await expect(
      contentTitles({} as never, 'COURSE', new Map(), 'en-US'),
    ).resolves.toEqual(new Map());
  });

  it('falls back from locale to source locale to any', async () => {
    const prisma = {
      contentTranslation: {
        findMany: jest.fn(async () => [
          { entityId: 'a', locale: 'es-ES', value: 'Hola' },
          { entityId: 'b', locale: 'pt-BR', value: 'Olá' },
          { entityId: 'b', locale: 'en-US', value: 'Hello' },
        ]),
      },
    };
    const out = await contentTitles(
      prisma as never,
      'COURSE',
      new Map([
        ['a', 'pt-BR'],
        ['b', 'pt-BR'],
      ]),
      'en-US',
    );
    expect(out.get('a')).toBe('Hola');
    expect(out.get('b')).toBe('Hello');
  });
});
