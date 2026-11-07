import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TranslationsService } from '../translations/translations.service.js';
import type { AuditReadService } from './audit-read.service.js';
import {
  DashboardService,
  computeMrr,
  inferPeriod,
  monthlyCents,
} from './dashboard.service.js';

const admin: ApiUser = {
  userId: 'a1',
  clerkId: 'c',
  email: 'a@x',
  role: 'ADMIN',
  displayName: 'A',
};
const teacher: ApiUser = { ...admin, userId: 't1', role: 'TEACHER' };
const d = (s: string) => new Date(s);

describe('MRR helpers', () => {
  it('infers the billing period from the period length', () => {
    expect(inferPeriod(d('2026-01-01'), d('2026-02-01'))).toBe('MONTHLY');
    expect(inferPeriod(d('2026-01-01'), d('2027-01-01'))).toBe('ANNUAL');
  });

  it('spreads annual prices over 12 months', () => {
    expect(monthlyCents(2990, 'MONTHLY')).toBe(2990);
    expect(monthlyCents(23880, 'ANNUAL')).toBe(1990);
  });

  it('sums BRL prices and counts plans without a BRL price as excluded', () => {
    const prices = [
      {
        planId: 'p1',
        currency: 'BRL',
        period: 'MONTHLY' as const,
        amountCents: 2990,
        storeProductId: null,
      },
      {
        planId: 'p1',
        currency: 'BRL',
        period: 'ANNUAL' as const,
        amountCents: 23880,
        storeProductId: 'store_annual',
      },
      {
        planId: 'p2',
        currency: 'USD',
        period: 'MONTHLY' as const,
        amountCents: 999,
        storeProductId: null,
      },
    ];
    const month = {
      currentPeriodStart: d('2026-01-01'),
      currentPeriodEnd: d('2026-02-01'),
    };
    const out = computeMrr(
      [
        { planId: 'p1', storeProductId: null, ...month },
        // Store subscription: the period comes from its product, not dates.
        { planId: 'p1', storeProductId: 'store_annual', ...month },
        { planId: 'p2', storeProductId: null, ...month },
      ],
      prices,
    );
    expect(out).toEqual({ amountCents: 2990 + 1990, excluded: 1 });
  });
});

function setup() {
  const prisma = {
    $queryRaw: jest.fn(),
    subscription: {
      findMany: jest.fn(async () => [
        {
          planId: 'p1',
          storeProductId: null,
          currentPeriodStart: d('2026-11-01'),
          currentPeriodEnd: d('2026-12-01'),
        },
      ]),
      count: jest.fn(async () => 2),
    },
    planPrice: {
      findMany: jest.fn(async () => [
        {
          planId: 'p1',
          currency: 'BRL',
          period: 'MONTHLY',
          amountCents: 2990,
          storeProductId: null,
        },
      ]),
    },
    contentTranslation: {
      findMany: jest.fn(async () => [
        { entityId: 'c1', locale: 'en-US', value: 'Intro EN' },
        { entityId: 'c1', locale: 'pt-BR', value: 'Intro PT' },
        { entityId: 'l1', locale: 'pt-BR', value: 'Aula 1' },
      ]),
    },
    enrollment: {
      groupBy: jest.fn(async () => [{ courseId: 'c1', _count: { _all: 3 } }]),
    },
    course: {
      findMany: jest.fn(async () => [
        { id: 'c1', slug: 'intro', sourceLocale: 'pt-BR' },
      ]),
    },
  };
  // Order of $queryRaw calls: active users, conversions, top courses (admin)
  // or drop-off (teacher) — answered by SQL text.
  prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('wau')) return [{ wau: 4n, mau: 9n }];
    if (sql.includes('MIN("createdAt")')) return [{ n: 1n }];
    if (sql.includes('lesson_open'))
      return [
        {
          lessonId: 'l1',
          courseSlug: 'intro',
          sourceLocale: 'pt-BR',
          started: 10n,
          completed: 4n,
        },
      ];
    return [
      {
        id: 'c1',
        slug: 'intro',
        sourceLocale: 'pt-BR',
        enrolled: 8n,
        completed: 2n,
      },
    ];
  });
  const translations = {
    completeness: jest.fn(async () => ({
      locales: {
        'pt-BR': { ALL: { total: 4, translated: 4, outdated: 0, pct: 100 } },
        'en-US': { ALL: { total: 4, translated: 1, outdated: 1, pct: 25 } },
      },
      entities: [],
    })),
  };
  const audit = { recent: jest.fn(async () => []) };
  const svc = new DashboardService(
    prisma as unknown as PrismaService,
    translations as unknown as TranslationsService,
    audit as unknown as AuditReadService,
  );
  return { svc, prisma, translations, audit };
}

describe('DashboardService.get', () => {
  const now = d('2026-11-07T12:00:00Z'); // a Saturday

  it('admin scope: KPIs, MRR and top courses in the caller locale', async () => {
    const { svc, audit } = setup();
    const res = await svc.get(admin, 'en-US', now);
    expect(res.scope).toBe('admin');
    expect(res.weekStart).toBe('2026-11-02T00:00:00.000Z');
    expect(res.teacher).toBeNull();
    expect(res.admin).toMatchObject({
      wau: 4,
      mau: 9,
      paidConversionsThisWeek: 1,
      activeSubscriptions: 1,
      trialingSubscriptions: 2,
      mrr: { currency: 'BRL', amountCents: 2990, excludedSubscriptions: 0 },
    });
    expect(res.admin?.topCourses).toEqual([
      {
        courseId: 'c1',
        slug: 'intro',
        title: 'Intro EN',
        enrolled: 8,
        completed: 2,
        completionRate: 0.25,
      },
    ]);
    expect(audit.recent).toHaveBeenCalledWith(admin, 20);
  });

  it('teacher scope: own enrollments today, drop-off and pending translations', async () => {
    const { svc, prisma, translations } = setup();
    const res = await svc.get(teacher, 'pt-BR', now);
    expect(res.scope).toBe('teacher');
    expect(res.admin).toBeNull();
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: { gte: d('2026-11-07T00:00:00Z') },
          course: { authorId: 't1', deletedAt: null },
        },
      }),
    );
    expect(translations.completeness).toHaveBeenCalledWith({ authorId: 't1' });
    expect(res.teacher).toEqual({
      enrollmentsToday: 3,
      enrollmentsTodayByCourse: [
        { courseId: 'c1', title: 'Intro PT', count: 3 },
      ],
      topDropOffLessons: [
        {
          lessonId: 'l1',
          title: 'Aula 1',
          courseSlug: 'intro',
          started: 10,
          completed: 4,
          dropOffRate: 0.6,
        },
      ],
      pendingTranslations: 3,
    });
  });
});
