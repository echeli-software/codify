import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  CompleteLessonResponse,
  CourseProgressResponse,
  ProgressItem,
} from './progress.dto.js';

/**
 * Service backing the Progress feature.
 *
 *   - `complete()`  records a lesson completion for the current user.
 *     It is **idempotent**: posting twice returns the original row
 *     and the unchanged totals (the caller distinguishes new vs. replay
 *     by the HTTP status code the controller emits).
 *   - `forCourse()` returns every completion the current user has for
 *     lessons inside a given course, plus the total/complete counts so
 *     the curriculum view can show "3 of 12 done".
 *
 * Authorization rules:
 *   - The lesson's course must be `PUBLISHED` (a draft is invisible to
 *     STUDENT — same 404 as the lessons.detail path).
 *   - Non-`isFree` lessons return **402 Payment Required** until
 *     Phase 6 wires `Enrollment` + Stripe. The client surfaces this as
 *     the paywall sheet.
 */
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a completion. Awards `lesson.baseXp` + `lesson.baseCoins`
   * and bumps the User's running totals **inside the same transaction**
   * so totals never diverge from the journal of Progress rows.
   *
   * `wasNew` is true on first completion and false on idempotent replay.
   * Controller maps that to 201 vs 200.
   */
  async complete(
    actor: ApiUser,
    lessonId: string,
  ): Promise<CompleteLessonResponse & { wasNew: boolean }> {
    if (actor.role !== 'STUDENT') {
      throw new ForbiddenException('Only students can complete lessons');
    }

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!lesson || lesson.module.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Lesson not found');
    }
    if (!lesson.isFree) {
      // Phase 6 will check Enrollment + subscription here; for now the
      // free-flag is the only gate. 402 = the paywall trigger.
      throw new HttpException('Subscription required', 402);
    }

    const existing = await this.prisma.progress.findUnique({
      where: { userId_lessonId: { userId: actor.userId, lessonId } },
    });

    if (existing) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { totalXp: true, coins: true },
      });
      return {
        wasNew: false,
        progress: toItem(existing),
        totals: { totalXp: user.totalXp, coins: user.coins },
      };
    }

    const { progress, totals } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.progress.create({
        data: {
          userId: actor.userId,
          lessonId,
          xpAwarded: lesson.baseXp,
          coinsAwarded: lesson.baseCoins,
        },
      });
      const updated = await tx.user.update({
        where: { id: actor.userId },
        data: {
          totalXp: { increment: lesson.baseXp },
          coins: { increment: lesson.baseCoins },
        },
        select: { totalXp: true, coins: true },
      });
      return { progress: created, totals: updated };
    });

    return {
      wasNew: true,
      progress: toItem(progress),
      totals,
    };
  }

  async forCourse(
    actor: ApiUser,
    courseId: string,
  ): Promise<CourseProgressResponse> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (actor.role === 'STUDENT' && course.status !== 'PUBLISHED') {
      throw new NotFoundException('Course not found');
    }

    const lessons = await this.prisma.lesson.findMany({
      where: { deletedAt: null, module: { courseId } },
      select: { id: true },
    });
    const lessonIds = lessons.map((l) => l.id);

    const rows = lessonIds.length
      ? await this.prisma.progress.findMany({
          where: {
            userId: actor.userId,
            lessonId: { in: lessonIds },
          },
          orderBy: { completedAt: 'asc' },
        })
      : [];

    return {
      courseId,
      totalLessons: lessons.length,
      completedLessons: rows.length,
      items: rows.map(toItem),
    };
  }
}

function toItem(row: {
  lessonId: string;
  completedAt: Date;
  xpAwarded: number;
  coinsAwarded: number;
}): ProgressItem {
  return {
    lessonId: row.lessonId,
    completedAt: row.completedAt.toISOString(),
    xpAwarded: row.xpAwarded,
    coinsAwarded: row.coinsAwarded,
  };
}
