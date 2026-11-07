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

/**
 * Mirrors the Prisma `EnrollmentSource` enum. Only PROMO / ADMIN_GRANT
 * enrollments grant paid access (docs/09-billing §3 step 3 — the spec's
 * "GIFT" is the ADMIN_GRANT source); SELF enrollments are bookkeeping only.
 */
export type EnrollmentSource = 'SELF' | 'PROMO' | 'ADMIN_GRANT';

export const DEFAULT_PAST_DUE_GRACE_DAYS = 3;

/** GamificationConfig key overriding the PAST_DUE grace window (days). */
export const PAST_DUE_GRACE_DAYS_CONFIG_KEY = 'billing.pastDueGraceDays';

const DAY_MS = 86_400_000;

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
  /** Renewal boundary — the end of the paid window. */
  currentPeriodEnd: Date | string;
  /** Auto-renew is off: access stops at `currentPeriodEnd`. */
  cancelAtPeriodEnd?: boolean;
  /**
   * When the subscription first became PAST_DUE. The grace window is
   * measured from here (falls back to `currentPeriodEnd` when unknown).
   */
  pastDueSince?: Date | string | null;
}

export interface EnrollmentLike {
  source: EnrollmentSource;
  /** PROMO / ADMIN_GRANT access expiry; null/undefined = no expiry. */
  accessUntil?: Date | string | null;
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * True while `now` is strictly before `end`. Every access window in this
 * module is the half-open interval `[start, end)`: at the instant a window
 * ends, access is already gone.
 */
function before(now: Date, end: Date | string): boolean {
  return now.getTime() < asDate(end).getTime();
}

/**
 * Normalise a configured grace-days value (GamificationConfig JSON):
 * a finite, non-negative number, else the default.
 */
export function normalizeGraceDays(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_PAST_DUE_GRACE_DAYS;
}

/**
 * Does a single subscription currently grant access? Encodes the
 * SubscriptionStatus × access table from /docs/09-billing.md §3.
 *
 * - TRIALING / ACTIVE → yes; when `cancelAtPeriodEnd` (auto-renew off,
 *   non-renewing prepay, admin grant) only until `currentPeriodEnd`.
 * - PAST_DUE          → yes for `graceDays` from `pastDueSince`
 *                       (fallback: `currentPeriodEnd`), then no.
 * - CANCELED          → no, unless it was a cancel-at-period-end that is
 *                       still inside its paid window (`currentPeriodEnd`).
 * - everything else   → no (INCOMPLETE, INCOMPLETE_EXPIRED, UNPAID, PAUSED).
 */
export function subscriptionGrantsAccess(
  sub: SubscriptionLike,
  now: Date = new Date(),
  graceDays: number = DEFAULT_PAST_DUE_GRACE_DAYS,
): boolean {
  switch (sub.status) {
    case 'TRIALING':
    case 'ACTIVE':
      return sub.cancelAtPeriodEnd ? before(now, sub.currentPeriodEnd) : true;
    case 'PAST_DUE': {
      const anchor = asDate(sub.pastDueSince ?? sub.currentPeriodEnd);
      const days = normalizeGraceDays(graceDays);
      return before(now, new Date(anchor.getTime() + days * DAY_MS));
    }
    case 'CANCELED':
      return (
        sub.cancelAtPeriodEnd === true && before(now, sub.currentPeriodEnd)
      );
    default:
      return false;
  }
}

/** Does an enrollment currently grant paid access to its course? */
export function enrollmentGrantsAccess(
  e: EnrollmentLike,
  now: Date = new Date(),
): boolean {
  if (e.source !== 'PROMO' && e.source !== 'ADMIN_GRANT') return false;
  return e.accessUntil == null || before(now, e.accessUntil);
}

/** Does a plan unlock a course given that course's category ids? */
export function planIncludesCourse(
  plan: PlanAccessLike,
  courseCategoryIds: string[],
): boolean {
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
  return plans.filter(
    (p) => p.isActive && planIncludesCourse(p, courseCategoryIds),
  );
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
  /**
   * Plans used to resolve each subscription's categories. Pass ALL
   * (non-deleted) plans, inactive ones included: a subscriber keeps access
   * when their plan is later deactivated. `requiredPlans` suggestions are
   * filtered to active plans here.
   */
  plans: PlanAccessLike[];
  now?: Date;
  pastDueGraceDays?: number;
}

/**
 * The single source of truth for "can this user open this lesson?".
 * Evaluated in priority order (/docs/09-billing.md §3):
 *   1. lesson.isFree                              → free_lesson
 *   2. whole course is free                       → free_course
 *   3. PROMO/ADMIN_GRANT enrollment, unexpired    → enrollment
 *   4. access-granting subscription whose plan
 *      includes one of the course's categories    → subscription
 *   5. otherwise                                  → paywall (+ requiredPlans)
 */
export function canUserAccessLesson(input: LessonAccessInput): AccessResult {
  const now = input.now ?? new Date();
  const graceDays = input.pastDueGraceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS;

  if (input.lesson.isFree) return { granted: true, reason: 'free_lesson' };
  if (input.course.allLessonsFree)
    return { granted: true, reason: 'free_course' };

  if ((input.enrollments ?? []).some((e) => enrollmentGrantsAccess(e, now))) {
    return { granted: true, reason: 'enrollment' };
  }

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
