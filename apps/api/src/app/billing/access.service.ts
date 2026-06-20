import { Injectable, NotFoundException } from '@nestjs/common';
import {
  canUserAccessLesson,
  plansIncludingCourse,
  type AccessResult,
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
  async loadActivePlans(): Promise<PlanAccessLike[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, deletedAt: null },
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

  private async loadUserSubscriptions(userId: string): Promise<SubscriptionLike[]> {
    const subs = await this.prisma.subscription.findMany({
      where: { userId },
      select: { planId: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
    });
    return subs.map((s) => ({
      planId: s.planId,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    }));
  }

  private async courseShape(
    courseId: string,
  ): Promise<{ categoryIds: string[]; allLessonsFree: boolean }> {
    const [cats, lessonAgg] = await this.prisma.$transaction([
      this.prisma.courseCategory.findMany({
        where: { courseId },
        select: { categoryId: true },
      }),
      this.prisma.lesson.groupBy({
        by: ['isFree'],
        where: { deletedAt: null, module: { courseId } },
        _count: { _all: true },
      }),
    ]);
    const total = lessonAgg.reduce((s, g) => s + g._count._all, 0);
    const paid = lessonAgg.find((g) => g.isFree === false)?._count._all ?? 0;
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
    const [course, subscriptions, plans] = await Promise.all([
      this.courseShape(courseId),
      this.loadUserSubscriptions(userId),
      this.loadActivePlans(),
    ]);
    const access = canUserAccessLesson({
      lesson: { isFree: lesson.isFree },
      course,
      subscriptions,
      plans,
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
