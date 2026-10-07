import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { QuestsService } from '../gamification/quests.service.js';
import { BadgesService } from '../gamification/badges.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type { CoinSource, LessonType, XpSource } from '@prisma/client';
import type { QuestEventContext } from '../gamification/quests.service.js';
import type {
  CompleteLessonResponse,
  CourseProgressResponse,
  ProgressItem,
} from './progress.dto.js';

export interface RecordCompletionParams {
  userId: string;
  lessonId: string;
  xpSource: XpSource;
  coinSource: CoinSource;
  /** What earned it, for the ledger: 'lesson' | 'quiz' | 'exercise' | 'ai_prompt' | 'scenario' | 'capstone'. */
  refType: string;
  refId: string;
  /** Quest event kind; defaults to 'lesson_complete'. */
  questEvent?: QuestEventContext['type'];
  /** Offline-queue client time, so streak credit lands on the right local day. */
  clientTimestamp?: string | null;
}

export type RecordCompletionResult = CompleteLessonResponse & {
  /** True when the lesson was already complete; nothing was granted. */
  alreadyCompleted: boolean;
};

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
    opts: { clientTimestamp?: string | null } = {},
  ): Promise<CompleteLessonResponse> {
    if (actor.role !== 'STUDENT') {
      throw new ForbiddenException('Only students can complete lessons');
    }
    const clientTimestamp = validateClientTimestamp(opts.clientTimestamp);

    // Phase 6: server-authoritative access. The same @codify/domain rule the
    // client uses for UI gating decides here, so they never drift. A paywall
    // verdict becomes 402 carrying the plans the student could buy.
    // (resolveLessonAccess also 404s a missing / unpublished lesson.)
    const { access } = await this.access.resolveLessonAccess(
      actor.userId,
      lessonId,
    );
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

    await this.assertDirectlyCompletable(lessonId);

    const out = await this.recordCompletion({
      userId: actor.userId,
      lessonId,
      xpSource: 'LESSON_COMPLETE',
      coinSource: 'LESSON_COMPLETE',
      refType: 'lesson',
      refId: lessonId,
      clientTimestamp,
    });
    if (out.alreadyCompleted) {
      throw new ConflictException({
        message: 'Lesson already completed',
        statusCode: 409,
        code: 'LESSON_ALREADY_COMPLETED',
        progress: out.progress,
        totals: out.totals,
      });
    }
    const { alreadyCompleted: _replay, ...response } = out;
    return response;
  }

  /**
   * Lessons that are graded by their own flow cannot be completed by the
   * bare "mark complete" endpoint — otherwise a client could skip the
   * exercise / AI prompt / scenario / quiz and still collect the reward.
   */
  private async assertDirectlyCompletable(lessonId: string): Promise<void> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: { type: true, contentJson: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (SELF_GRADED_TYPES.has(lesson.type)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'LESSON_COMPLETES_VIA_OWN_FLOW',
        lessonType: lesson.type,
        message: `${lesson.type} lessons are completed by passing them, not by marking them complete`,
      });
    }
    if (lesson.type === 'QUIZ' && containsQuizBlock(lesson.contentJson)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'QUIZ_REQUIRES_GRADING',
        lessonType: lesson.type,
        message: 'This quiz is completed by submitting answers',
      });
    }
  }

  /**
   * The single place a lesson becomes complete and pays its reward. Every
   * completion flow (reading, quiz pass, exercise first pass, AI-prompt
   * pass, scenario ending, capstone) calls this, so a lesson can never be
   * rewarded twice regardless of which flow got there first.
   *
   * Writes the Progress row, grants XP/coins (multipliers, streak, level-up,
   * milestones), advances quests and evaluates badges in ONE transaction.
   * Idempotent: if the lesson is already complete — including when a
   * concurrent request wins the race — it returns the existing record with
   * `alreadyCompleted: true` and grants nothing. Callers decide whether a
   * replay is an error (the public `complete()` maps it to 409).
   *
   * Does not check role or paywall access; callers do that first.
   */
  async recordCompletion(
    params: RecordCompletionParams,
  ): Promise<RecordCompletionResult> {
    const { userId, lessonId } = params;
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!lesson || lesson.module.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Lesson not found');
    }

    const existing = await this.prisma.progress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    if (existing) return this.replay(userId, existing);

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
          data: { userId, lessonId, xpAwarded: 0, coinsAwarded: 0 },
        });
        // Server-authoritative reward: XP/coins (with multipliers), streak,
        // level-up, streak milestone — all in this transaction. One key per
        // (user, lesson) across every flow.
        const granted = await this.gamification.grantReward(
          {
            userId,
            baseXp: lesson.baseXp,
            baseCoins: lesson.baseCoins,
            xpSource: params.xpSource,
            coinSource: params.coinSource,
            refType: params.refType,
            refId: params.refId,
            idempotencyKey: `lesson_reward:${userId}:${lessonId}`,
            courseId,
            lessonId,
            countsForStreak: true,
            clientTimestamp: params.clientTimestamp ?? null,
          },
          tx,
        );

        // Advance daily quests + evaluate badges in the same transaction so
        // their (flat) rewards land atomically with the completion.
        const questsCompleted = await this.quests.onEvent(tx, userId, {
          type: params.questEvent ?? 'lesson_complete',
          courseId,
          categoryIds,
          xpEarned: granted.xp,
          streakAdvanced: granted.streak !== null,
        });
        const badgesUnlocked = await this.badges.evaluate(tx, userId);

        // Re-read final totals (quest/badge bonuses may have added more).
        const finalUser = await tx.user.findUniqueOrThrow({
          where: { id: userId },
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
        return {
          progress: finalized,
          reward: granted,
          questsCompleted,
          badgesUnlocked,
        };
      });
      return {
        alreadyCompleted: false,
        progress: toItem(out.progress),
        totals: out.reward.totals,
        reward: out.reward,
        questsCompleted: out.questsCompleted,
        badgesUnlocked: out.badgesUnlocked,
      };
    } catch (err) {
      // Race window between findUnique and create — another request
      // (different device, retried offline-queue, a parallel flow) just
      // landed the row. Report it as a replay, never as a second award.
      if (isUniqueViolation(err)) {
        const raced = await this.prisma.progress.findUnique({
          where: { userId_lessonId: { userId, lessonId } },
        });
        if (raced) return this.replay(userId, raced);
      }
      throw err;
    }
  }

  /** The already-completed response: original Progress + current totals. */
  private async replay(
    userId: string,
    existing: {
      lessonId: string;
      completedAt: Date;
      xpAwarded: number;
      coinsAwarded: number;
    },
  ): Promise<RecordCompletionResult> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totalXp: true, coins: true },
    });
    return {
      alreadyCompleted: true,
      progress: toItem(existing),
      totals: { totalXp: user.totalXp, coins: user.coins },
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

/** Lesson types completed through their own graded endpoint. */
export const SELF_GRADED_TYPES: ReadonlySet<LessonType> = new Set<LessonType>([
  'EXERCISE',
  'AI_PROMPT',
  'SCENARIO',
  'CAPSTONE',
]);

/** Offline completions may be at most this old / this far in the future. */
export const CLIENT_TIMESTAMP_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const CLIENT_TIMESTAMP_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Validate an offline-queue `clientTimestamp` (docs/16 §8 "Streak
 * attribution"). Rejects (400) times more than 5 min in the future or older
 * than 72 h; returns the normalised ISO string, or null when absent.
 */
export function validateClientTimestamp(
  value: string | null | undefined,
  now = Date.now(),
): string | null {
  if (value === undefined || value === null || value === '') return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_CLIENT_TIMESTAMP',
      message: 'clientTimestamp must be an ISO-8601 date-time',
    });
  }
  if (t - now > CLIENT_TIMESTAMP_MAX_SKEW_MS) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'CLIENT_TIMESTAMP_IN_FUTURE',
      message: 'clientTimestamp is in the future',
    });
  }
  if (now - t > CLIENT_TIMESTAMP_MAX_AGE_MS) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'CLIENT_TIMESTAMP_TOO_OLD',
      message: 'clientTimestamp is older than 72 hours',
    });
  }
  return new Date(t).toISOString();
}

/** True when a Tiptap doc contains a graded `quiz` block anywhere. */
export function containsQuizBlock(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 50) return false;
  if (Array.isArray(node))
    return node.some((n) => containsQuizBlock(n, depth + 1));
  const o = node as { type?: unknown; content?: unknown };
  if (o.type === 'quiz') return true;
  return containsQuizBlock(o.content, depth + 1);
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
