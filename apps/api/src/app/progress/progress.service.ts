import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { levelFromXp } from '@codify/ui-core';
import { lessonBaseReward, localDateKey, localDayStart } from '@codify/domain';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import type { RewardResult } from '../gamification/gamification.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { QuestsService } from '../gamification/quests.service.js';
import { BadgesService } from '../gamification/badges.service.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import type { CompletedQuest } from '../gamification/quests.service.js';
import type { UnlockedBadge } from '../gamification/badges.service.js';
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
  /** Graded quiz pass: drives the perfect-score and per-question bonuses. */
  quiz?: { scorePct: number; correctCount: number; totalCount: number };
  /**
   * Scenario play-through that reached an ending: on a replay of an
   * already-completed lesson, a *new* ending pays SCENARIO_BRANCH.
   */
  scenario?: { scenarioId: string; endingKey: string; isNewEnding: boolean };
}

export type RecordCompletionResult = CompleteLessonResponse & {
  /**
   * True when the lesson was already complete; the first-completion reward
   * was not paid again. A retake / new scenario ending may still carry a
   * (smaller) `reward` — then `retake` is true.
   */
  alreadyCompleted: boolean;
  /** True when this replay paid a RETAKE / SCENARIO_BRANCH reward. */
  retake?: boolean;
};

/** Sources whose re-pass pays the once-a-day RETAKE reward (docs/07 §2). */
const RETAKE_SOURCES = new Set(['EXERCISE_PASS', 'AI_PROMPT_PASS']);

const DEFAULT_TZ = 'America/Sao_Paulo';

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
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gamification: GamificationService,
    private readonly quests: QuestsService,
    private readonly badges: BadgesService,
    private readonly config: GamificationConfigService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  /**
   * Quest titles + badge names/descriptions of a completion's celebration
   * in the caller's locale (docs/11 §3); after the transaction, one query.
   */
  private async localizeRewards(
    quests: CompletedQuest[],
    badges: UnlockedBadge[],
  ): Promise<void> {
    if (!this.localizer || (quests.length === 0 && badges.length === 0)) return;
    const tr = await this.localizer.localize([
      {
        entityType: 'QUEST',
        items: quests.flatMap((q) =>
          q.templateId
            ? [{ id: q.templateId, values: { title: q.title } }]
            : [],
        ),
      },
      {
        entityType: 'BADGE',
        items: badges.map((b) => ({
          id: b.id,
          values: { name: b.name, description: b.description },
        })),
      },
    ]);
    for (const q of quests)
      if (q.templateId) tr.apply('QUEST', q.templateId, q, ['title']);
    for (const b of badges) tr.apply('BADGE', b.id, b, ['name', 'description']);
  }

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
    const clientTimestamp = validateClientTimestamp(
      opts.clientTimestamp,
      Date.now(),
      (msg) =>
        this.logger.warn(`${msg} (user=${actor.userId}, lesson=${lessonId})`),
    );

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

    // Course categories — needed for category-scoped quests.
    const courseId = lesson.module.course.id;
    const categoryIds = async () =>
      (
        await this.prisma.courseCategory.findMany({
          where: { courseId },
          select: { categoryId: true },
        })
      ).map((c) => c.categoryId);

    const existing = await this.prisma.progress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    if (existing) {
      return this.replayWithRepeatReward(params, existing, {
        courseId,
        categoryIds,
      });
    }

    const cfg = await this.config.getMany([
      'earning.byLessonType',
      'earning.quizPerfectBonus',
      'earning.quizPerQuestionBonus',
    ]);
    // Per-type defaults unless the author changed the lesson's own values
    // (docs/07 §2; rule in @codify/domain lessonBaseReward).
    const base = lessonBaseReward(lesson, cfg['earning.byLessonType']);
    const cats = await categoryIds();

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
            baseXp: base.xp,
            baseCoins: base.coins,
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

        // Quiz bonuses (docs/07 §2): their own ledger rows (QUIZ_PERFECT /
        // per-question), multiplied like the completion, folded into the
        // one reward the client celebrates.
        if (params.quiz) {
          const q = params.quiz;
          const perQ = cfg['earning.quizPerQuestionBonus'];
          if (q.correctCount > 0 && (perQ.xp > 0 || perQ.coins > 0)) {
            mergeBonus(
              granted,
              'QUIZ_QUESTIONS',
              await this.gamification.grantReward(
                {
                  userId,
                  baseXp: perQ.xp * q.correctCount,
                  baseCoins: perQ.coins * q.correctCount,
                  xpSource: params.xpSource,
                  coinSource: params.coinSource,
                  refType: 'quiz_questions',
                  refId: params.refId,
                  idempotencyKey: `quiz_questions:${userId}:${lessonId}`,
                  courseId,
                  lessonId,
                },
                tx,
              ),
            );
          }
          const perfect = cfg['earning.quizPerfectBonus'];
          if (q.scorePct >= 100 && (perfect.xp > 0 || perfect.coins > 0)) {
            mergeBonus(
              granted,
              'QUIZ_PERFECT',
              await this.gamification.grantReward(
                {
                  userId,
                  baseXp: perfect.xp,
                  baseCoins: perfect.coins,
                  xpSource: 'QUIZ_PERFECT',
                  coinSource: 'QUIZ_PERFECT',
                  refType: 'quiz_perfect',
                  refId: params.refId,
                  idempotencyKey: `quiz_perfect:${userId}:${lessonId}`,
                  courseId,
                  lessonId,
                },
                tx,
              ),
            );
          }
        }

        // Advance daily quests + evaluate badges in the same transaction so
        // their (flat) rewards land atomically with the completion.
        const questsCompleted = await this.quests.onEvent(tx, userId, {
          type: params.questEvent ?? 'lesson_complete',
          courseId,
          categoryIds: cats,
          xpEarned: granted.xp,
          streakAdvanced: granted.streak?.extended ?? granted.streak !== null,
        });
        const badgesUnlocked = await this.badges.evaluate(tx, userId, {
          type: params.questEvent ?? 'lesson_complete',
          lessonId,
          scorePct: params.quiz?.scorePct ?? null,
          afterStreakLost: granted.streak?.restartedAfterLoss ?? false,
        });

        // docs/10 §6: a rare surprise boost for the rest of the session.
        granted.surpriseBoost = await this.gamification.maybeStartSurpriseBoost(
          tx,
          userId,
        );

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
      await this.localizeRewards(out.questsCompleted, out.badgesUnlocked);
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

  /**
   * A completion flow ran again for a lesson that is already complete.
   * Exercise / AI-prompt re-passes pay RETAKE once per lesson per user-local
   * day, and a scenario play-through that reached a new ending pays
   * SCENARIO_BRANCH (at most `earning.scenarioBranch.dailyCap` per scenario
   * per day, the first completion counting when it was today). Both count
   * for the streak and for quests/badges (not for lesson-count quests).
   * Anything else is a plain replay.
   */
  private async replayWithRepeatReward(
    params: RecordCompletionParams,
    existing: {
      lessonId: string;
      completedAt: Date;
      xpAwarded: number;
      coinsAwarded: number;
    },
    ctx: { courseId: string; categoryIds: () => Promise<string[]> },
  ): Promise<RecordCompletionResult> {
    const { userId, lessonId } = params;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user.timezone || DEFAULT_TZ;
    const now = new Date();
    const today = localDateKey(now, tz);

    let reward: {
      key: string;
      xp: number;
      coins: number;
      xpSource: 'RETAKE' | 'SCENARIO_BRANCH';
      refType: string;
      refId: string;
    } | null = null;

    if (RETAKE_SOURCES.has(params.xpSource)) {
      const r = await this.config.get('earning.retake');
      reward = {
        key: `retake:${userId}:${lessonId}:${today}`,
        xp: r.xp,
        coins: r.coins,
        xpSource: 'RETAKE',
        refType: `${params.refType}_retake`,
        refId: params.refId,
      };
    } else if (params.scenario?.isNewEnding) {
      const b = await this.config.get('earning.scenarioBranch');
      const { scenarioId, endingKey } = params.scenario;
      const dayStart = localDayStart(now, tz);
      const branchesToday = await this.prisma.idempotencyRecord.count({
        where: {
          userId,
          scope: 'scenario_branch',
          key: { startsWith: `scenario_branch:${userId}:${scenarioId}:` },
          createdAt: { gte: dayStart },
        },
      });
      const firstToday = existing.completedAt >= dayStart ? 1 : 0;
      if (branchesToday + firstToday < b.dailyCap) {
        reward = {
          key: `scenario_branch:${userId}:${scenarioId}:${endingKey}`,
          xp: b.xp,
          coins: b.coins,
          xpSource: 'SCENARIO_BRANCH',
          refType: 'scenario_branch',
          refId: scenarioId,
        };
      }
    }
    if (!reward || (reward.xp <= 0 && reward.coins <= 0))
      return this.replay(userId, existing);

    const r = reward;
    const cats = await ctx.categoryIds();
    try {
      const out = await this.prisma.$transaction(async (tx) => {
        // The record is the once-per-key guard (and the scenario-branch
        // daily counter); a racing duplicate fails here and rolls back.
        await tx.idempotencyRecord.create({
          data: {
            key: r.key,
            scope: r.xpSource === 'RETAKE' ? 'retake' : 'scenario_branch',
            userId,
          },
        });
        const granted = await this.gamification.grantReward(
          {
            userId,
            baseXp: r.xp,
            baseCoins: r.coins,
            xpSource: r.xpSource,
            coinSource: r.xpSource,
            refType: r.refType,
            refId: r.refId,
            idempotencyKey: r.key,
            courseId: ctx.courseId,
            lessonId,
            countsForStreak: true,
            clientTimestamp: params.clientTimestamp ?? null,
          },
          tx,
        );
        const questsCompleted = await this.quests.onEvent(tx, userId, {
          type: params.questEvent ?? 'lesson_complete',
          courseId: ctx.courseId,
          categoryIds: cats,
          xpEarned: granted.xp,
          streakAdvanced: granted.streak?.extended ?? false,
          repeat: true,
        });
        const badgesUnlocked = await this.badges.evaluate(tx, userId, {
          type: params.questEvent ?? 'lesson_complete',
          lessonId,
          scorePct: null,
          afterStreakLost: granted.streak?.restartedAfterLoss ?? false,
        });
        const finalUser = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totalXp: true, coins: true },
        });
        granted.totals = {
          totalXp: finalUser.totalXp,
          coins: finalUser.coins,
          level: levelFromXp(finalUser.totalXp),
        };
        return { granted, questsCompleted, badgesUnlocked };
      });
      await this.localizeRewards(out.questsCompleted, out.badgesUnlocked);
      return {
        alreadyCompleted: true,
        retake: true,
        progress: toItem(existing),
        totals: out.granted.totals,
        reward: out.granted,
        questsCompleted: out.questsCompleted,
        badgesUnlocked: out.badgesUnlocked,
      };
    } catch (err) {
      // Already paid today / this ending (or a concurrent request won).
      if (isUniqueViolation(err)) return this.replay(userId, existing);
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

/** Offline event times older than this are clamped to "now" (docs/16 §8). */
export const CLIENT_TIMESTAMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Normalise an offline-queue `clientTimestamp` (docs/16 §8 "Streak
 * attribution"). A time more than 24 h in the past or any time in the
 * future is **clamped to now** and logged as a warning (a sanity rail
 * against fake clocks, not a security boundary) — the event itself is
 * still accepted. Only an unparseable value is a 400
 * (`INVALID_CLIENT_TIMESTAMP`). Returns the ISO string, or null when absent.
 */
export function validateClientTimestamp(
  value: string | null | undefined,
  now = Date.now(),
  warn: (message: string) => void = (m) => clampLogger.warn(m),
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
  if (t > now) {
    warn(`clientTimestamp ${value} is in the future; clamped to now`);
    return new Date(now).toISOString();
  }
  if (now - t > CLIENT_TIMESTAMP_MAX_AGE_MS) {
    warn(`clientTimestamp ${value} is older than 24 h; clamped to now`);
    return new Date(now).toISOString();
  }
  return new Date(t).toISOString();
}

const clampLogger = new Logger('ClientTimestamp');

/** Fold a bonus grant (quiz perfect / per-question) into the completion's reward. */
function mergeBonus(
  into: RewardResult,
  source: string,
  bonus: RewardResult,
): void {
  if (bonus.xp <= 0 && bonus.coins <= 0) return;
  into.xp += bonus.xp;
  into.coins += bonus.coins;
  into.breakdown.push({ source, xp: bonus.xp, coins: bonus.coins });
  into.totals = bonus.totals;
  if (bonus.levelUp) into.levelUp = bonus.levelUp;
  if (bonus.coinCap) {
    into.coinCap = {
      requested:
        (into.coinCap?.requested ?? into.coins - bonus.coins) +
        bonus.coinCap.requested,
      pooled: (into.coinCap?.pooled ?? 0) + bonus.coinCap.pooled,
      dropped: (into.coinCap?.dropped ?? 0) + bonus.coinCap.dropped,
    };
  }
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
