import {
  canUserAccessLesson,
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
  const base = { planId: 'plan-fe', currentPeriodEnd: future(10) } as SubscriptionLike;

  it('ACTIVE and TRIALING grant access', () => {
    expect(subscriptionGrantsAccess({ ...base, status: 'ACTIVE' }, NOW)).toBe(true);
    expect(subscriptionGrantsAccess({ ...base, status: 'TRIALING' }, NOW)).toBe(true);
  });

  it('INCOMPLETE / UNPAID / PAUSED do not', () => {
    for (const status of ['INCOMPLETE', 'INCOMPLETE_EXPIRED', 'UNPAID', 'PAUSED'] as const) {
      expect(subscriptionGrantsAccess({ ...base, status }, NOW)).toBe(false);
    }
  });

  it('PAST_DUE grants within the grace window then revokes', () => {
    // period ended 2 days ago, 3-day grace → still in window
    expect(
      subscriptionGrantsAccess({ ...base, status: 'PAST_DUE', currentPeriodEnd: past(2) }, NOW),
    ).toBe(true);
    // period ended 4 days ago → past grace
    expect(
      subscriptionGrantsAccess({ ...base, status: 'PAST_DUE', currentPeriodEnd: past(4) }, NOW),
    ).toBe(false);
  });

  it('CANCELED grants until currentPeriodEnd', () => {
    expect(
      subscriptionGrantsAccess({ ...base, status: 'CANCELED', currentPeriodEnd: future(3) }, NOW),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({ ...base, status: 'CANCELED', currentPeriodEnd: past(1) }, NOW),
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
    const result = plansIncludingCourse([frontend, allAccess, inactive], ['cat-fe']);
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

  it('GIFT/PROMO enrollment grants', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-mobile'], allLessonsFree: false },
      subscriptions: [],
      enrollments: [{ source: 'GIFT' }],
      plans,
    });
    expect(r.reason).toBe('enrollment');
  });

  it('matching active subscription grants', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-fe'], allLessonsFree: false },
      subscriptions: [{ planId: 'plan-fe', status: 'ACTIVE', currentPeriodEnd: future(10) }],
      plans,
      now: NOW,
    });
    expect(r.reason).toBe('subscription');
  });

  it('subscription to a non-matching plan does not grant; returns required plans', () => {
    const r = canUserAccessLesson({
      lesson: { isFree: false },
      course: { categoryIds: ['cat-mobile'], allLessonsFree: false },
      subscriptions: [{ planId: 'plan-fe', status: 'ACTIVE', currentPeriodEnd: future(10) }],
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
      subscriptions: [{ planId: 'plan-fe', status: 'CANCELED', currentPeriodEnd: past(1) }],
      plans,
      now: NOW,
    });
    expect(r.granted).toBe(false);
    expect(r.requiredPlans?.map((p) => p.id).sort()).toEqual(['plan-all', 'plan-fe']);
  });
});
