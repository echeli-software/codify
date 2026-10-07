import {
  canUserAccessLesson,
  DEFAULT_PAST_DUE_GRACE_DAYS,
  enrollmentGrantsAccess,
  normalizeGraceDays,
  planIncludesCourse,
  plansIncludingCourse,
  subscriptionGrantsAccess,
  type PlanAccessLike,
  type SubscriptionLike,
} from './domain.js';

const frontend: PlanAccessLike = {
  id: 'plan-fe',
  slug: 'frontend',
  name: 'Frontend',
  isAllAccess: false,
  isActive: true,
  categoryIds: ['cat-fe'],
};
const allAccess: PlanAccessLike = {
  id: 'plan-all',
  slug: 'everything',
  name: 'Everything',
  isAllAccess: true,
  isActive: true,
  categoryIds: [],
};

const NOW = new Date('2026-06-20T12:00:00Z');
const future = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const past = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('subscriptionGrantsAccess', () => {
  const base = {
    planId: 'plan-fe',
    currentPeriodEnd: future(10),
  } as SubscriptionLike;

  it('ACTIVE and TRIALING grant access', () => {
    expect(subscriptionGrantsAccess({ ...base, status: 'ACTIVE' }, NOW)).toBe(
      true,
    );
    expect(subscriptionGrantsAccess({ ...base, status: 'TRIALING' }, NOW)).toBe(
      true,
    );
  });

  it('INCOMPLETE / UNPAID / PAUSED do not', () => {
    for (const status of [
      'INCOMPLETE',
      'INCOMPLETE_EXPIRED',
      'UNPAID',
      'PAUSED',
    ] as const) {
      expect(subscriptionGrantsAccess({ ...base, status }, NOW)).toBe(false);
    }
  });

  it('PAST_DUE without pastDueSince falls back to currentPeriodEnd', () => {
    // period ended 2 days ago, 3-day grace → still in window
    expect(
      subscriptionGrantsAccess(
        { ...base, status: 'PAST_DUE', currentPeriodEnd: past(2) },
        NOW,
      ),
    ).toBe(true);
    // period ended 4 days ago → past grace
    expect(
      subscriptionGrantsAccess(
        { ...base, status: 'PAST_DUE', currentPeriodEnd: past(4) },
        NOW,
      ),
    ).toBe(false);
  });

  it('PAST_DUE grace is measured from pastDueSince, not the (advanced) period end', () => {
    // Stripe advances currentPeriodEnd before the renewal charge fails, so
    // the period end is a month away — the grace must still run out.
    const pastDue = {
      ...base,
      status: 'PAST_DUE' as const,
      currentPeriodEnd: future(29),
    };
    expect(
      subscriptionGrantsAccess({ ...pastDue, pastDueSince: past(2) }, NOW),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({ ...pastDue, pastDueSince: past(4) }, NOW),
    ).toBe(false);
  });

  it('PAST_DUE honours a configured grace and the boundary is exclusive', () => {
    const pastDue = {
      ...base,
      status: 'PAST_DUE' as const,
      pastDueSince: past(5),
    };
    expect(subscriptionGrantsAccess(pastDue, NOW, 7)).toBe(true);
    expect(subscriptionGrantsAccess(pastDue, NOW, 5)).toBe(false); // exactly at cliff
    expect(
      subscriptionGrantsAccess({ ...pastDue, pastDueSince: NOW }, NOW, 0),
    ).toBe(false);
    // ISO strings are accepted too
    expect(
      subscriptionGrantsAccess(
        { ...pastDue, pastDueSince: past(1).toISOString() },
        NOW,
      ),
    ).toBe(true);
  });

  it('ACTIVE / TRIALING with cancelAtPeriodEnd keep access only until period end', () => {
    for (const status of ['ACTIVE', 'TRIALING'] as const) {
      const sub = { ...base, status, cancelAtPeriodEnd: true };
      expect(
        subscriptionGrantsAccess({ ...sub, currentPeriodEnd: future(1) }, NOW),
      ).toBe(true);
      expect(
        subscriptionGrantsAccess({ ...sub, currentPeriodEnd: NOW }, NOW),
      ).toBe(false);
      expect(
        subscriptionGrantsAccess({ ...sub, currentPeriodEnd: past(1) }, NOW),
      ).toBe(false);
    }
    // Without the flag an ACTIVE sub renews: a lagging period end does not revoke.
    expect(
      subscriptionGrantsAccess(
        { ...base, status: 'ACTIVE', currentPeriodEnd: past(1) },
        NOW,
      ),
    ).toBe(true);
  });

  it('CANCELED grants only while a cancel-at-period-end window is still open', () => {
    const canceled = { ...base, status: 'CANCELED' as const };
    expect(
      subscriptionGrantsAccess(
        { ...canceled, cancelAtPeriodEnd: true, currentPeriodEnd: future(3) },
        NOW,
      ),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess(
        { ...canceled, cancelAtPeriodEnd: true, currentPeriodEnd: past(1) },
        NOW,
      ),
    ).toBe(false);
    expect(
      subscriptionGrantsAccess(
        { ...canceled, cancelAtPeriodEnd: true, currentPeriodEnd: NOW },
        NOW,
      ),
    ).toBe(false);
    // Immediately canceled → no access even if the period end is in the future.
    expect(
      subscriptionGrantsAccess(
        { ...canceled, cancelAtPeriodEnd: false, currentPeriodEnd: future(3) },
        NOW,
      ),
    ).toBe(false);
    expect(
      subscriptionGrantsAccess(
        { ...canceled, currentPeriodEnd: future(3) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('normalizeGraceDays', () => {
  it('accepts finite non-negative numbers, else defaults to 3', () => {
    expect(normalizeGraceDays(5)).toBe(5);
    expect(normalizeGraceDays(0)).toBe(0);
    expect(normalizeGraceDays(-1)).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
    expect(normalizeGraceDays('7')).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
    expect(normalizeGraceDays(null)).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
    expect(normalizeGraceDays(Number.NaN)).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
  });
});

describe('enrollmentGrantsAccess', () => {
  it('PROMO / ADMIN_GRANT with no expiry or a future expiry grant', () => {
    for (const source of ['PROMO', 'ADMIN_GRANT'] as const) {
      expect(enrollmentGrantsAccess({ source }, NOW)).toBe(true);
      expect(enrollmentGrantsAccess({ source, accessUntil: null }, NOW)).toBe(
        true,
      );
      expect(
        enrollmentGrantsAccess({ source, accessUntil: future(1) }, NOW),
      ).toBe(true);
    }
  });

  it('expired PROMO / ADMIN_GRANT do not grant (exclusive boundary)', () => {
    expect(
      enrollmentGrantsAccess({ source: 'PROMO', accessUntil: past(1) }, NOW),
    ).toBe(false);
    expect(
      enrollmentGrantsAccess({ source: 'ADMIN_GRANT', accessUntil: NOW }, NOW),
    ).toBe(false);
  });

  it('SELF enrollments never grant paid access', () => {
    expect(enrollmentGrantsAccess({ source: 'SELF' }, NOW)).toBe(false);
    expect(
      enrollmentGrantsAccess({ source: 'SELF', accessUntil: future(9) }, NOW),
    ).toBe(false);
  });
});

describe('planIncludesCourse / plansIncludingCourse', () => {
  it('matches on shared category', () => {
    expect(planIncludesCourse(frontend, ['cat-fe', 'cat-x'])).toBe(true);
    expect(planIncludesCourse(frontend, ['cat-mobile'])).toBe(false);
  });

  it('all-access plan always includes', () => {
    expect(planIncludesCourse(allAccess, [])).toBe(true);
    expect(planIncludesCourse(allAccess, ['anything'])).toBe(true);
  });

  it('plansIncludingCourse returns active matches only', () => {
    const inactive = { ...frontend, id: 'plan-old', isActive: false };
    const result = plansIncludingCourse(
      [frontend, allAccess, inactive],
      ['cat-fe'],
    );
    expect(result.map((p) => p.id).sort()).toEqual(['plan-all', 'plan-fe']);
  });
});

describe('canUserAccessLesson', () => {
  const plans = [frontend, allAccess];

  it('free lesson is always granted', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: true },
      course: { categoryIds: ['cat-mobile'], allLessonsFree: false },
      subscriptions: [],
      plans,
    });
    expect(r).toEqual({ granted: true, reason: 'free_lesson' });
  });

  it('fully-free course grants a paid lesson', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-mobile'], allLessonsFree: true },
      subscriptions: [],
      plans,
    });
    expect(r.reason).toBe('free_course');
  });

  it('ADMIN_GRANT / PROMO enrollment grants', () => {
    for (const source of ['ADMIN_GRANT', 'PROMO'] as const) {
      const r = canUserAccessLesson({
        lesson: { isFree: false },
        course: { categoryIds: ['cat-mobile'], allLessonsFree: false },
        subscriptions: [],
        enrollments: [{ source, accessUntil: future(1) }],
        plans,
        now: NOW,
      });
      expect(r).toEqual({ granted: true, reason: 'enrollment' });
    }
  });

  it('expired or SELF enrollment falls through to paywall', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-mobile'], allLessonsFree: false },
      subscriptions: [],
      enrollments: [
        { source: 'PROMO', accessUntil: past(1) },
        { source: 'SELF' },
      ],
      plans,
      now: NOW,
    });
    expect(r.reason).toBe('paywall');
  });

  it('a subscription keeps access after its plan is deactivated; suggestions stay active-only', () => {
    const retired = { ...frontend, id: 'plan-retired', isActive: false };
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      subscriptions: [
        {
          planId: 'plan-retired',
          status: 'ACTIVE',
          currentPeriodEnd: future(10),
        },
      ],
      plans: [retired, allAccess],
      now: NOW,
    });
    expect(r).toEqual({ granted: true, reason: 'subscription' });

    const paywalled = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      subscriptions: [],
      plans: [retired, allAccess],
      now: NOW,
    });
    expect(paywalled.requiredPlans?.map((p) => p.id)).toEqual(['plan-all']);
  });

  it('PAST_DUE subscription uses pastDueSince and the configured grace', () => {
    const input = {
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      subscriptions: [
        {
          planId: 'plan-fe',
          status: 'PAST_DUE' as const,
          currentPeriodEnd: future(29),
          pastDueSince: past(4),
        },
      ],
      plans,
      now: NOW,
    };
    expect(canUserAccessLesson(input).granted).toBe(false);
    expect(canUserAccessLesson({ ...input, pastDueGraceDays: 7 }).granted).toBe(
      true,
    );
  });

  it('cancel-at-period-end subscription grants until the period ends', () => {
    const input = {
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      plans,
      now: NOW,
    };
    expect(
      canUserAccessLesson({
        ...input,
        subscriptions: [
          {
            planId: 'plan-fe',
            status: 'ACTIVE',
            cancelAtPeriodEnd: true,
            currentPeriodEnd: future(2),
          },
        ],
      }).granted,
    ).toBe(true);
    expect(
      canUserAccessLesson({
        ...input,
        subscriptions: [
          {
            planId: 'plan-fe',
            status: 'ACTIVE',
            cancelAtPeriodEnd: true,
            currentPeriodEnd: past(2),
          },
        ],
      }).granted,
    ).toBe(false);
  });

  it('matching active subscription grants', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      subscriptions: [
        { planId: 'plan-fe', status: 'ACTIVE', currentPeriodEnd: future(10) },
      ],
      plans,
      now: NOW,
    });
    expect(r.reason).toBe('subscription');
  });

  it('subscription to a non-matching plan does not grant; returns required plans', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-mobile'], allLessonsFree: false },
      subscriptions: [
        { planId: 'plan-fe', status: 'ACTIVE', currentPeriodEnd: future(10) },
      ],
      plans,
      now: NOW,
    });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('paywall');
    // only the all-access plan covers cat-mobile
    expect(r.requiredPlans?.map((p) => p.id)).toEqual(['plan-all']);
  });

  it('expired subscription falls through to paywall', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      subscriptions: [
        { planId: 'plan-fe', status: 'CANCELED', currentPeriodEnd: past(1) },
      ],
      plans,
      now: NOW,
    });
    expect(r.granted).toBe(false);
    expect(r.requiredPlans?.map((p) => p.id).sort()).toEqual([
      'plan-all',
      'plan-fe',
    ]);
  });
});
