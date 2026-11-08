import type { ApiUser } from '../auth/auth.types.js';
import { REPORT_WEEKS, ReportsService, weekStarts } from './reports.service.js';

const teacher: ApiUser = {
  userId: 't1',
  role: 'TEACHER',
  clerkId: 'c',
  email: 't@x.y',
  displayName: 'T',
};

describe('ReportsService', () => {
  it('weekStarts: the last N UTC Mondays, oldest first', () => {
    const weeks = weekStarts(new Date('2026-11-08T12:00:00Z')); // a Sunday
    expect(weeks).toHaveLength(REPORT_WEEKS);
    expect(weeks[REPORT_WEEKS - 1].toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    );
    expect(weeks[0].toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(weeks.every((w) => w.getUTCDay() === 1)).toBe(true);
  });

  it('course funnels: a teacher is scoped to own courses and refused others', async () => {
    const queryRaw = jest.fn(async () => []);
    const prisma = {
      $queryRaw: queryRaw,
      course: {
        findFirst: jest.fn(async () => ({
          id: 'c2',
          authorId: 'someone-else',
          sourceLocale: 'pt-BR',
        })),
      },
      contentTranslation: { findMany: jest.fn(async () => []) },
    };
    const svc = new ReportsService(prisma as never);
    await svc.courseFunnels(teacher, 'en-US');
    // The author filter is bound to the teacher's id.
    expect((queryRaw.mock.calls[0] as unknown[]).slice(1)).toContain('t1');
    await expect(
      svc.courseFunnel(teacher, 'c2', 'en-US'),
    ).rejects.toMatchObject({ response: { code: 'NOT_COURSE_AUTHOR' } });
  });

  it('overview is cached between calls unless fresh is asked', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => []),
      subscription: { findMany: jest.fn(async () => []) },
      planPrice: { findMany: jest.fn(async () => []) },
      plan: { findMany: jest.fn(async () => []) },
    };
    const svc = new ReportsService(prisma as never);
    const now = new Date('2026-11-08T12:00:00Z');
    const a = await svc.overview(now);
    expect(a.billing.trialToPaid).toEqual({
      trialsEnded: 0,
      converted: 0,
      rate: null,
    });
    expect(a.shop).toHaveLength(REPORT_WEEKS);
    const calls = prisma.$queryRaw.mock.calls.length;
    await svc.overview(new Date(now.getTime() + 60_000));
    expect(prisma.$queryRaw.mock.calls.length).toBe(calls);
    await svc.overview(now, true);
    expect(prisma.$queryRaw.mock.calls.length).toBeGreaterThan(calls);
  });
});
