import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  BadgesService,
  UserMetrics,
} from '../gamification/badges.service.js';
import { BadgeTestService, explainRule } from './badge-test.service.js';

const metrics: UserMetrics = {
  events: { lesson_complete: 12, exercise_pass: 0 },
  metrics: { 'streak.current_days': 3 },
};

describe('explainRule', () => {
  it('explains each clause with the engine verdict', () => {
    const out = explainRule(
      {
        all: [
          { event: 'lesson_complete', count: { gte: 10 } },
          { event: 'exercise_pass' },
          { metric: 'streak.current_days', gte: 7 },
        ],
      },
      metrics,
    );
    expect(out.mode).toBe('all');
    expect(out.clauses).toEqual([
      {
        kind: 'event',
        key: 'lesson_complete',
        predicate: { gte: 10 },
        value: 12,
        passed: true,
      },
      {
        kind: 'event',
        key: 'exercise_pass',
        predicate: { gte: 1 },
        value: 0,
        passed: false,
      },
      {
        kind: 'metric',
        key: 'streak.current_days',
        predicate: { gte: 7 },
        value: 3,
        passed: false,
      },
    ]);
  });

  it('handles empty any rules (manual badges)', () => {
    expect(explainRule({ any: [] }, metrics)).toEqual({
      mode: 'any',
      clauses: [],
    });
  });
});

describe('BadgeTestService', () => {
  function setup(opts: { earned?: boolean; rule?: unknown } = {}) {
    const prisma = {
      badge: {
        findUnique: jest.fn(async () => ({
          id: 'b1',
          isActive: true,
          rule: opts.rule ?? {
            any: [{ event: 'lesson_complete', count: { gte: 10 } }],
          },
        })),
      },
      user: { findFirst: jest.fn(async () => ({ id: 'u1' })) },
      userBadge: {
        findUnique: jest.fn(async () =>
          opts.earned ? { awardedAt: new Date('2026-10-01T00:00:00Z') } : null,
        ),
        create: jest.fn(),
      },
    };
    const badges = { computeMetrics: jest.fn(async () => metrics) };
    return {
      svc: new BadgeTestService(
        prisma as unknown as PrismaService,
        badges as unknown as BadgesService,
      ),
      prisma,
      badges,
    };
  }

  it('reports wouldUnlock without awarding', async () => {
    const { svc, prisma, badges } = setup();
    const res = await svc.test('b1', 'u1');
    expect(badges.computeMetrics).toHaveBeenCalledWith(prisma, 'u1');
    expect(prisma.userBadge.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      wouldUnlock: true,
      alreadyEarned: false,
      awardedAt: null,
      mode: 'any',
      events: metrics.events,
    });
  });

  it('flags already-earned badges', async () => {
    const { svc } = setup({
      earned: true,
      rule: { all: [{ metric: 'streak.current_days', gte: 7 }] },
    });
    const res = await svc.test('b1', 'u1');
    expect(res).toMatchObject({
      wouldUnlock: false,
      alreadyEarned: true,
      awardedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('404s unknown users', async () => {
    const { svc, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(null as never);
    await expect(svc.test('b1', 'x')).rejects.toMatchObject({
      response: { code: 'USER_NOT_FOUND' },
    });
  });
});
