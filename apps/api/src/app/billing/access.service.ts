import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canUserAccessLesson,
  normalizeGraceDays,
  PAST_DUE_GRACE_DAYS_CONFIG_KEY,
  plansIncludingCourse,
  type AccessResult,
  type EnrollmentLike,
  type PlanAccessLike,
  type SubscriptionLike,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Server-side access resolution. Loads the data the pure
 * `@codify/domain` access functions need and applies the exact same rule
 * the client uses for UI gating, so enforcement and presentation never
 * drift. See /docs/09-billing.md §3.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** All active plans, shaped for the domain layer (categoryIds inlined). */
  loadActivePlans(): Promise<PlanAccessLike[]> {
    return this.loadPlans({ isActive: true, deletedAt: null });
  }

  /**
   * Every non-deleted plan, inactive ones included: a subscription keeps
   * granting its plan's categories after the plan stops being sold. The
   * domain filters `requiredPlans` suggestions back to active plans.
   */
  loadPlansForAccess(): Promise<PlanAccessLike[]> {
    return this.loadPlans({ deletedAt: null });
  }

  private async loadPlans(
    where: Prisma.PlanWhereInput,
  ): Promise<PlanAccessLike[]> {
    const plans = await this.prisma.plan.findMany({
      where,
      include: { categories: { select: { categoryId: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      isAllAccess: p.isAllAccess,
      isActive: p.isActive,
      categoryIds: p.categories.map((c) => c.categoryId),
    }));
  }

  /** PAST_DUE grace window: GamificationConfig `billing.pastDueGraceDays`, default 3. */
  async pastDueGraceDays(): Promise<number> {
    const row = await this.prisma.gamificationConfig.findUnique({
      where: { key: PAST_DUE_GRACE_DAYS_CONFIG_KEY },
    });
    return normalizeGraceDays(row?.value);
  }

  private async loadUserSubscriptions(
    userId: string,
  ): Promise<SubscriptionLike[]> {
    const subs = await this.prisma.subscription.findMany({
      where: { userId },
      select: {
        planId: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        pastDueSince: true,
      },
    });
    return subs.map((s) => ({
      planId: s.planId,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      pastDueSince: s.pastDueSince,
    }));
  }

  private async loadEnrollments(
    userId: string,
    courseId: string,
  ): Promise<EnrollmentLike[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: { userId, courseId, source: { in: ['PROMO', 'ADMIN_GRANT'] } },
      select: { source: true, accessUntil: true },
    });
    return rows.map((e) => ({ source: e.source, accessUntil: e.accessUntil }));
  }

  private async courseShape(
    courseId: string,
  ): Promise<{ categoryIds: string[]; allLessonsFree: boolean }> {
    const lessonWhere = { deletedAt: null, module: { courseId } };
    const [cats, total, paid] = await this.prisma.$transaction([
      this.prisma.courseCategory.findMany({
        where: { courseId },
        select: { categoryId: true },
      }),
      this.prisma.lesson.count({ where: lessonWhere }),
      this.prisma.lesson.count({ where: { ...lessonWhere, isFree: false } }),
    ]);
    return {
      categoryIds: cats.map((c) => c.categoryId),
      allLessonsFree: total > 0 && paid === 0,
    };
  }

  /** Resolve access for a specific lesson, loading its course context. */
  async resolveLessonAccess(
    userId: string,
    lessonId: string,
  ): Promise<{ access: AccessResult; courseId: string }> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!lesson || lesson.module.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Lesson not found');
    }
    const courseId = lesson.module.course.id;
    const [course, subscriptions, enrollments, plans, pastDueGraceDays] =
      await Promise.all([
        this.courseShape(courseId),
        this.loadUserSubscriptions(userId),
        this.loadEnrollments(userId, courseId),
        this.loadPlansForAccess(),
        this.pastDueGraceDays(),
      ]);
    const access = canUserAccessLesson({
      lesson: { isFree: lesson.isFree },
      course,
      subscriptions,
      enrollments,
      plans,
      pastDueGraceDays,
    });
    return { access, courseId };
  }

  /** Plans that unlock a given course — for course-detail chips + paywall. */
  async plansForCourse(courseId: string): Promise<PlanAccessLike[]> {
    const [course, plans] = await Promise.all([
      this.courseShape(courseId),
      this.loadActivePlans(),
    ]);
    return plansIncludingCourse(plans, course.categoryIds);
  }
}
