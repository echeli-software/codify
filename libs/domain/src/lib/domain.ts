/**
 * Pure access-control domain logic shared by the API (enforcement) and the
 * client apps (UI gating). No framework or Prisma deps — plain data in,
 * plain verdict out — so the exact same rule runs server- and client-side.
 *
 * See /docs/09-billing.md §2 (plan↔category) and §3 (access logic).
 */

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED';

export type EnrollmentSource = 'PLAN' | 'FREE' | 'GIFT' | 'PROMO';

export const DEFAULT_PAST_DUE_GRACE_DAYS = 3;

export interface PlanAccessLike {
  id: string;
  slug: string;
  name: string;
  isAllAccess: boolean;
  isActive: boolean;
  /** Categories this plan unlocks. Ignored when `isAllAccess`. */
  categoryIds: string[];
}

export interface SubscriptionLike {
  planId: string;
  status: SubscriptionStatus;
  /** Renewal boundary. For CANCELED/PAST_DUE this is the access cliff. */
  currentPeriodEnd: Date | string;
  cancelAtPeriodEnd?: boolean;
}

export interface EnrollmentLike {
  source: EnrollmentSource;
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * Does a single subscription currently grant access? Encodes the
 * SubscriptionStatus × access table from /docs/09-billing.md §3.
 *
 * - TRIALING / ACTIVE       → yes
 * - PAST_DUE                → yes within `graceDays` of `currentPeriodEnd`, then no
 * - CANCELED                → yes until `currentPeriodEnd` (the paid window)
 * - everything else         → no
 */
export function subscriptionGrantsAccess(
  sub: SubscriptionLike,
  now: Date = new Date(),
  graceDays: number = DEFAULT_PAST_DUE_GRACE_DAYS,
): boolean {
  switch (sub.status) {
    case 'TRIALING':
    case 'ACTIVE':
      return true;
    case 'PAST_DUE': {
      const cliff = asDate(sub.currentPeriodEnd).getTime() + graceDays * 86_400_000;
      return now.getTime() <= cliff;
    }
    case 'CANCELED':
      return now.getTime() < asDate(sub.currentPeriodEnd).getTime();
    default:
      // INCOMPLETE, INCOMPLETE_EXPIRED, UNPAID, PAUSED
      return false;
  }
}

/** Does a plan unlock a course given that course's category ids? */
export function planIncludesCourse(plan: PlanAccessLike, courseCategoryIds: string[]): boolean {
  if (plan.isAllAccess) return true;
  return plan.categoryIds.some((c) => courseCategoryIds.includes(c));
}

/**
 * All active plans that include the given course — rendered as chips on the
 * course-detail page and the paywall sheet. See /docs/09-billing.md §2.
 */
export function plansIncludingCourse(
  plans: PlanAccessLike[],
  courseCategoryIds: string[],
): PlanAccessLike[] {
  return plans.filter((p) => p.isActive && planIncludesCourse(p, courseCategoryIds));
}

export type AccessReason =
  | 'free_lesson'
  | 'free_course'
  | 'enrollment'
  | 'subscription'
  | 'paywall';

export interface AccessResult {
  granted: boolean;
  reason: AccessReason;
  /** Populated only when `reason === 'paywall'`: plans the user could buy. */
  requiredPlans?: PlanAccessLike[];
}

export interface LessonAccessInput {
  lesson: { isFree: boolean };
  course: {
    categoryIds: string[];
    /** True when every lesson in the course is free. */
    allLessonsFree: boolean;
  };
  /** The user's subscriptions (any status — filtered here). */
  subscriptions: SubscriptionLike[];
  /** The user's enrollments for THIS course. */
  enrollments?: EnrollmentLike[];
  /** All active plans, used to resolve subscription categories + requiredPlans. */
  plans: PlanAccessLike[];
  now?: Date;
  pastDueGraceDays?: number;
}

/**
 * The single source of truth for "can this user open this lesson?".
 * Evaluated in priority order (/docs/09-billing.md §3):
 *   1. lesson.isFree                              → free_lesson
 *   2. whole course is free                       → free_course
 *   3. active GIFT/PROMO enrollment               → enrollment
 *   4. access-granting subscription whose plan
 *      includes one of the course's categories    → subscription
 *   5. otherwise                                  → paywall (+ requiredPlans)
 */
export function canUserAccessLesson(input: LessonAccessInput): AccessResult {
  const now = input.now ?? new Date();
  const graceDays = input.pastDueGraceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS;

  if (input.lesson.isFree) return { granted: true, reason: 'free_lesson' };
  if (input.course.allLessonsFree) return { granted: true, reason: 'free_course' };

  const hasManualEnrollment = (input.enrollments ?? []).some(
    (e) => e.source === 'GIFT' || e.source === 'PROMO',
  );
  if (hasManualEnrollment) return { granted: true, reason: 'enrollment' };

  const planById = new Map(input.plans.map((p) => [p.id, p]));
  for (const sub of input.subscriptions) {
    if (!subscriptionGrantsAccess(sub, now, graceDays)) continue;
    const plan = planById.get(sub.planId);
    if (plan && planIncludesCourse(plan, input.course.categoryIds)) {
      return { granted: true, reason: 'subscription' };
    }
  }

  return {
    granted: false,
    reason: 'paywall',
    requiredPlans: plansIncludingCourse(input.plans, input.course.categoryIds),
  };
}
