import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { QuestsService } from '../gamification/quests.service.js';
import { BadgesService } from '../gamification/badges.service.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gamification: GamificationService,
    private readonly quests: QuestsService,
    private readonly badges: BadgesService,
  ) {}

  /**
   * Record a completion. Awards `lesson.baseXp` + `lesson.baseCoins`
   * and bumps the User's running totals **inside the same transaction**
   * so totals never diverge from the journal of Progress rows.
   *
   * Behavior on duplicates: per /docs/16-offline.md §8, a second
   * completion for the same (userId, lessonId) is `409 Conflict`. The
   * conflict body carries the original Progress payload + current
   * totals so the offline-sync queue can drop the event and reconcile
   * the UI without crediting twice.
   */
  async complete(
    actor: ApiUser,
    lessonId: string,
  ): Promise<CompleteLessonResponse> {
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

    // Phase 6: server-authoritative access. The same @codify/domain rule the
    // client uses for UI gating decides here, so they never drift. A paywall
    // verdict becomes 402 carrying the plans the student could buy.
    const { access } = await this.access.resolveLessonAccess(actor.userId, lessonId);
    if (!access.granted) {
      throw new HttpException(
        {
          statusCode: 402,
          message: 'Subscription required',
          reason: access.reason,
          requiredPlans: access.requiredPlans ?? [],
        },
        402,
      );
    }

    const existing = await this.prisma.progress.findUnique({
      where: { userId_lessonId: { userId: actor.userId, lessonId } },
    });
    if (existing) throw await this.conflictFromExisting(actor.userId, existing);

    // Course categories — needed for category-scoped quests.
    const courseId = lesson.module.course.id;
    const courseCats = await this.prisma.courseCategory.findMany({
      where: { courseId },
      select: { categoryId: true },
    });
    const categoryIds = courseCats.map((c) => c.categoryId);

    try {
      const out = await this.prisma.$transaction(async (tx) => {
        // Create the Progress row first so the (userId, lessonId) unique
        // constraint is the authoritative double-award guard — a racing
        // duplicate fails here and the whole tx (including the grant) rolls back.
        const created = await tx.progress.create({
          data: { userId: actor.userId, lessonId, xpAwarded: 0, coinsAwarded: 0 },
        });
        // Server-authoritative reward: XP/coins (with multipliers), streak,
        // level-up, streak milestone — all in this transaction.
        const granted = await this.gamification.grantReward(
          {
            userId: actor.userId,
            baseXp: lesson.baseXp,
            baseCoins: lesson.baseCoins,
            xpSource: 'LESSON_COMPLETE',
            coinSource: 'LESSON_COMPLETE',
            refType: 'lesson',
            refId: lessonId,
            idempotencyKey: `lesson_complete:${actor.userId}:${lessonId}`,
            courseId,
            lessonId,
            countsForStreak: true,
          },
          tx,
        );

        // Advance daily quests + evaluate badges in the same transaction so
        // their (flat) rewards land atomically with the completion.
        const questsCompleted = await this.quests.onEvent(tx, actor.userId, {
          type: 'lesson_complete',
          courseId,
          categoryIds,
          xpEarned: granted.xp,
          streakAdvanced: true,
        });
        const badgesUnlocked = await this.badges.evaluate(tx, actor.userId);

        // Re-read final totals (quest/badge bonuses may have added more).
        const finalUser = await tx.user.findUniqueOrThrow({
          where: { id: actor.userId },
          select: { totalXp: true, coins: true },
        });
        granted.totals = {
          totalXp: finalUser.totalXp,
          coins: finalUser.coins,
          level: levelFromXp(finalUser.totalXp),
        };

        // Progress journal stores the lesson's own award (not quest/badge).
        const finalized = await tx.progress.update({
          where: { id: created.id },
          data: { xpAwarded: granted.xp, coinsAwarded: granted.coins },
        });
        return { progress: finalized, reward: granted, questsCompleted, badgesUnlocked };
      });
      return {
        progress: toItem(out.progress),
        totals: out.reward.totals,
        reward: out.reward,
        questsCompleted: out.questsCompleted,
        badgesUnlocked: out.badgesUnlocked,
      };
    } catch (err) {
      // Race window between findUnique and create — another request
      // (different device, retried offline-queue, etc.) just landed
      // the row. Translate the Prisma P2002 into the same 409 shape so
      // clients have a single conflict path to handle.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.progress.findUnique({
          where: { userId_lessonId: { userId: actor.userId, lessonId } },
        });
        if (raced) throw await this.conflictFromExisting(actor.userId, raced);
      }
      throw err;
    }
  }

  /** Build the 409 payload referenced from both the fast and slow conflict paths. */
  private async conflictFromExisting(
    userId: string,
    existing: { lessonId: string; completedAt: Date; xpAwarded: number; coinsAwarded: number },
  ): Promise<ConflictException> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totalXp: true, coins: true },
    });
    return new ConflictException({
      message: 'Lesson already completed',
      statusCode: 409,
      progress: toItem(existing),
      totals: { totalXp: user.totalXp, coins: user.coins },
    });
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
