import { AccessService } from './access.service.js';

const DAY_MS = 86_400_000;

function setup(
  opts: {
    graceConfig?: unknown;
    enrollments?: unknown[];
    subs?: unknown[];
  } = {},
) {
  const prisma = {
    lesson: {
      findFirst: jest.fn(async () => ({
        id: 'lesson-1',
        isFree: false,
        module: { course: { id: 'course-1', status: 'PUBLISHED' } },
      })),
      count: jest.fn(async () => 0),
    },
    courseCategory: {
      findMany: jest.fn(async () => [{ categoryId: 'cat-fe' }]),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => {
      const [cats] = await Promise.all(ops);
      return [cats, 3, 3];
    }),
    plan: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [
          {
            id: 'plan-retired',
            slug: 'r',
            name: 'R',
            isAllAccess: false,
            isActive: false,
            categories: [{ categoryId: 'cat-fe' }],
          },
          {
            id: 'plan-all',
            slug: 'a',
            name: 'A',
            isAllAccess: true,
            isActive: true,
            categories: [],
          },
        ].filter(
          (p) =>
            where['isActive'] === undefined || p.isActive === where['isActive'],
        ),
      ),
    },
    subscription: { findMany: jest.fn(async () => opts.subs ?? []) },
    enrollment: { findMany: jest.fn(async () => opts.enrollments ?? []) },
    gamificationConfig: {
      findUnique: jest.fn(async () =>
        opts.graceConfig === undefined
          ? null
          : { key: 'billing.pastDueGraceDays', value: opts.graceConfig },
      ),
    },
  };
  return { prisma, svc: new AccessService(prisma as never) };
}

describe('AccessService', () => {
  it('a subscription to a deactivated plan still grants; plans are loaded without the isActive filter', async () => {
    const { prisma, svc } = setup({
      subs: [
        {
          planId: 'plan-retired',
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
          cancelAtPeriodEnd: false,
          pastDueSince: null,
        },
      ],
    });
    const { access } = await svc.resolveLessonAccess('user-1', 'lesson-1');
    expect(access).toEqual({ granted: true, reason: 'subscription' });
    expect(prisma.plan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('paywall suggestions only list active plans', async () => {
    const { svc } = setup();
    const { access } = await svc.resolveLessonAccess('user-1', 'lesson-1');
    expect(access.reason).toBe('paywall');
    expect(access.requiredPlans?.map((p) => p.id)).toEqual(['plan-all']);
  });

  it('loads PROMO / ADMIN_GRANT enrollments for the course and honours accessUntil', async () => {
    const { prisma, svc } = setup({
      enrollments: [
        { source: 'ADMIN_GRANT', accessUntil: new Date(Date.now() + DAY_MS) },
      ],
    });
    const { access } = await svc.resolveLessonAccess('user-1', 'lesson-1');
    expect(access.reason).toBe('enrollment');
    expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          courseId: 'course-1',
          source: { in: ['PROMO', 'ADMIN_GRANT'] },
        },
      }),
    );

    const expired = setup({
      enrollments: [
        { source: 'PROMO', accessUntil: new Date(Date.now() - DAY_MS) },
      ],
    });
    expect(
      (await expired.svc.resolveLessonAccess('user-1', 'lesson-1')).access
        .reason,
    ).toBe('paywall');
  });

  it('PAST_DUE grace comes from GamificationConfig billing.pastDueGraceDays', async () => {
    const pastDue = {
      planId: 'plan-retired',
      status: 'PAST_DUE',
      currentPeriodEnd: new Date(Date.now() + 25 * DAY_MS),
      cancelAtPeriodEnd: false,
      pastDueSince: new Date(Date.now() - 5 * DAY_MS),
    };
    const byDefault = setup({ subs: [pastDue] });
    expect(
      (await byDefault.svc.resolveLessonAccess('u', 'lesson-1')).access.granted,
    ).toBe(false);
    const configured = setup({ subs: [pastDue], graceConfig: 7 });
    expect(
      (await configured.svc.resolveLessonAccess('u', 'lesson-1')).access
        .granted,
    ).toBe(true);
    expect(await setup({ graceConfig: 'bogus' }).svc.pastDueGraceDays()).toBe(
      3,
    );
  });
});

describe('AccessService.hasActiveSubscription (premium)', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const day = 86_400_000;
  function svcWith(
    subs: Array<Record<string, unknown>>,
    graceDays?: number,
  ): AccessService {
    const db = {
      subscription: { findMany: jest.fn(async () => subs) },
      gamificationConfig: {
        findUnique: jest.fn(async () =>
          graceDays === undefined ? null : { value: graceDays },
        ),
      },
    };
    return new AccessService(db as never);
  }
  const base = {
    planId: 'p1',
    cancelAtPeriodEnd: false,
    pastDueSince: null,
  };

  it('treats an expired admin grant / prepay (cancel-at-period-end) as not premium', async () => {
    const svc = svcWith([
      {
        ...base,
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(now.getTime() - day),
      },
    ]);
    await expect(svc.hasActiveSubscription('u1', undefined, now)).resolves.toBe(
      false,
    );
  });

  it('keeps a renewing ACTIVE subscription premium', async () => {
    const svc = svcWith([
      {
        ...base,
        status: 'ACTIVE',
        currentPeriodEnd: new Date(now.getTime() + day),
      },
    ]);
    await expect(svc.hasActiveSubscription('u1', undefined, now)).resolves.toBe(
      true,
    );
  });

  it('measures PAST_DUE grace from pastDueSince with the configured days', async () => {
    const pastDue = {
      ...base,
      status: 'PAST_DUE',
      currentPeriodEnd: new Date(now.getTime() + 25 * day),
      pastDueSince: new Date(now.getTime() - 2 * day),
    };
    await expect(
      svcWith([pastDue], 3).hasActiveSubscription('u1', undefined, now),
    ).resolves.toBe(true);
    await expect(
      svcWith([pastDue], 1).hasActiveSubscription('u1', undefined, now),
    ).resolves.toBe(false);
  });

  it('reads through a transaction client when given one', async () => {
    const tx = {
      subscription: { findMany: jest.fn(async () => []) },
      gamificationConfig: { findUnique: jest.fn(async () => null) },
    };
    const svc = new AccessService({} as never);
    await expect(
      svc.hasActiveSubscription('u1', tx as never, now),
    ).resolves.toBe(false);
    expect(tx.subscription.findMany).toHaveBeenCalled();
  });
});
