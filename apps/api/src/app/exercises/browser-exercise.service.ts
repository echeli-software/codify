import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  isBrowserExerciseLanguage,
  scoreFromResults,
  verdictFromResults,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import {
  ProgressService,
  validateClientTimestamp,
} from '../progress/progress.service.js';
import { toTests } from './exercise-tests.js';
import { RateLimitedException } from './rate-limit.js';
import {
  toResultJson,
  toView,
  type SubmissionView,
} from './submissions.service.js';
import type { BrowserResultDto } from './browser-exercise.dto.js';

/** Recorded browser runs per user + exercise per minute. */
export const BROWSER_RESULTS_PER_MINUTE = 10;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Records a browser-side exercise run (docs/12 §4). The tests ran in the
 * student's sandboxed iframe, so the verdict is **client-attested**: the
 * server checks the shape (every visible test reported exactly once, the
 * exercise is a `web` exercise the student can access, rate limits) and
 * then stores a COMPLETE Submission and, on a pass, completes the lesson
 * through ProgressService.recordCompletion (first pass only). Hidden
 * tests are never shipped to a browser, so web exercises grade on their
 * visible tests only.
 */
@Injectable()
export class BrowserExerciseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly progress: ProgressService,
  ) {}

  async record(
    userId: string,
    exerciseId: string,
    body: BrowserResultDto,
    idempotencyKey?: string,
  ): Promise<SubmissionView> {
    if (
      idempotencyKey !== undefined &&
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    )
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be 8–128 characters of [A-Za-z0-9_.:-]',
      });
    const clientTimestamp = validateClientTimestamp(body.clientTimestamp);
    const storedKey = idempotencyKey
      ? `${userId}:browser:${idempotencyKey}`
      : null;
    if (storedKey) {
      const seen = await this.prisma.submission.findUnique({
        where: { idempotencyKey: storedKey },
      });
      if (seen) {
        if (seen.userId !== userId || seen.exerciseId !== exerciseId)
          throw new NotFoundException('Submission not found');
        return toView(seen);
      }
    }

    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: {
        id: true,
        language: true,
        visibleTestsJson: true,
        lesson: { select: { id: true } },
      },
    });
    if (!exercise?.lesson) throw new NotFoundException('Exercise not found');
    if (!isBrowserExerciseLanguage(exercise.language))
      throw new BadRequestException({
        code: 'NOT_A_BROWSER_EXERCISE',
        message: 'This exercise is graded by the code runner, not the browser.',
      });
    const { access } = await this.access.resolveLessonAccess(
      userId,
      exercise.lesson.id,
    );
    if (!access.granted)
      throw new ForbiddenException('Subscription required for this lesson');

    const tests = toTests(exercise.visibleTestsJson);
    const reported = new Map(body.results.map((r) => [r.id, r]));
    if (
      tests.length === 0 ||
      reported.size !== body.results.length ||
      reported.size !== tests.length ||
      tests.some((t) => !reported.has(t.id))
    )
      throw new BadRequestException({
        code: 'BROWSER_RESULTS_MISMATCH',
        message: 'Report every test of the exercise exactly once.',
      });

    const recent = await this.prisma.submission.count({
      where: {
        userId,
        exerciseId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (recent >= BROWSER_RESULTS_PER_MINUTE)
      throw new RateLimitedException(
        'Too many runs — wait a minute before submitting again',
        60,
        'SUBMIT_RATE_LIMITED',
      );

    const results = tests.map((t) => {
      const r = reported.get(t.id) ?? { passed: false, error: undefined };
      return {
        id: t.id,
        name: t.name,
        passed: r.passed,
        hidden: false,
        ...(r.passed || !r.error ? {} : { error: r.error.slice(0, 500) }),
      };
    });
    const verdict = verdictFromResults(results);
    const passed = verdict === 'PASS';
    const outcome: Record<string, unknown> = {
      v: 1,
      results,
      errorKind: null,
      gradedBy: 'browser',
    };
    if (passed) {
      const done = await this.progress.recordCompletion({
        userId,
        lessonId: exercise.lesson.id,
        xpSource: 'EXERCISE_PASS',
        coinSource: 'EXERCISE_PASS',
        refType: 'exercise',
        refId: exercise.id,
        questEvent: 'exercise_pass',
        ...(clientTimestamp ? { clientTimestamp } : {}),
      });
      if (!done.alreadyCompleted) {
        outcome['reward'] = done.reward;
        outcome['questsCompleted'] = done.questsCompleted;
        outcome['badgesUnlocked'] = done.badgesUnlocked;
      }
    }
    try {
      const sub = await this.prisma.submission.create({
        data: {
          userId,
          exerciseId,
          code: body.code,
          status: 'COMPLETE',
          verdict,
          scored: true,
          scorePct: scoreFromResults(results),
          output: JSON.stringify(outcome),
          resultJson: toResultJson(
            results,
            passed,
          ) as unknown as Prisma.InputJsonValue,
          idempotencyKey: storedKey,
          completedAt: new Date(),
        },
      });
      return toView(sub);
    } catch (err) {
      if (storedKey && isUniqueViolation(err)) {
        const seen = await this.prisma.submission.findUnique({
          where: { idempotencyKey: storedKey },
        });
        if (seen && seen.userId === userId) return toView(seen);
      }
      throw err;
    }
  }
}
