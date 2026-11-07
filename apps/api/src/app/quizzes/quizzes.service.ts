import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import {
  DEFAULT_QUIZ_PASS_PCT,
  extractQuizzes,
  gradeQuiz,
  migrateLessonDoc,
  sanitizeQuizAnswers,
  type LessonDoc,
} from '@codify/lesson-schema';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import {
  ProgressService,
  validateClientTimestamp,
} from '../progress/progress.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  QuizAttemptResponse,
  QuizAttemptSummary,
  SubmitQuizAttemptDto,
} from './quizzes.dto.js';

/** One graded attempt per lesson per student every few seconds. */
export const QUIZ_ATTEMPT_COOLDOWN_MS = 3000;

/**
 * Server-authoritative quiz grading (docs/06 §quiz, docs/16 §8). The stored
 * lesson doc carries the answer key; students only ever receive a stripped
 * copy. A passing attempt completes the lesson through
 * ProgressService.recordCompletion, so the reward is paid exactly once no
 * matter how many attempts pass or which device syncs first.
 */
@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly progress: ProgressService,
  ) {}

  async submit(
    actor: ApiUser,
    lessonId: string,
    body: SubmitQuizAttemptDto,
    idempotencyKey?: string,
  ): Promise<QuizAttemptResponse> {
    const clientTimestamp = validateClientTimestamp(body.clientTimestamp);
    const doc = await this.loadGradableDoc(actor, lessonId);

    // A replayed key (offline-queue retry, flaky network) returns the
    // original attempt instead of recording a new one — and skips the
    // cooldown, since it is the same attempt.
    const recordKey = idempotencyKey
      ? `quiz_attempt:${actor.userId}:${lessonId}:${idempotencyKey}`
      : null;
    if (recordKey) {
      const seen = await this.prisma.idempotencyRecord.findUnique({
        where: { key: recordKey },
        select: { responseHash: true },
      });
      if (seen?.responseHash) {
        return this.replay(
          actor,
          lessonId,
          doc,
          seen.responseHash,
          clientTimestamp,
        );
      }
    }

    const recent = await this.prisma.quizAttempt.findFirst({
      where: { userId: actor.userId, lessonId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      recent &&
      Date.now() - recent.createdAt.getTime() < QUIZ_ATTEMPT_COOLDOWN_MS
    ) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'QUIZ_ATTEMPT_COOLDOWN',
          message: 'Wait a few seconds between quiz attempts',
        },
        429,
      );
    }

    const answers = sanitizeQuizAnswers(doc, body.answers);
    const grade = gradeQuiz(doc, answers, {
      passThresholdPct: DEFAULT_QUIZ_PASS_PCT,
    });

    let attempt: { id: string };
    try {
      attempt = await this.prisma.$transaction(async (tx) => {
        const created = await tx.quizAttempt.create({
          data: {
            userId: actor.userId,
            lessonId,
            answersJson: answers as Prisma.InputJsonValue,
            scorePct: grade.scorePct,
            passed: grade.passed,
          },
          select: { id: true },
        });
        if (recordKey) {
          // Stored with the attempt so the key only "exists" once the
          // attempt does; responseHash carries the attempt id for replays.
          await tx.idempotencyRecord.create({
            data: {
              key: recordKey,
              scope: 'quiz_attempt',
              userId: actor.userId,
              responseHash: created.id,
            },
          });
        }
        return created;
      });
    } catch (err) {
      // A concurrent request with the same key won the race.
      if (recordKey && isUniqueViolation(err)) {
        const seen = await this.prisma.idempotencyRecord.findUnique({
          where: { key: recordKey },
          select: { responseHash: true },
        });
        if (seen?.responseHash) {
          return this.replay(
            actor,
            lessonId,
            doc,
            seen.responseHash,
            clientTimestamp,
          );
        }
      }
      throw err;
    }

    return this.respond(actor, lessonId, attempt.id, grade, clientTimestamp);
  }

  /** Rebuild the response for an already-recorded attempt (deterministic regrade). */
  private async replay(
    actor: ApiUser,
    lessonId: string,
    doc: LessonDoc,
    attemptId: string,
    clientTimestamp: string | null,
  ): Promise<QuizAttemptResponse> {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      select: { answersJson: true, userId: true },
    });
    if (!attempt || attempt.userId !== actor.userId) {
      throw new NotFoundException('Quiz attempt not found');
    }
    const grade = gradeQuiz(
      doc,
      sanitizeQuizAnswers(doc, attempt.answersJson as Record<string, unknown>),
      { passThresholdPct: DEFAULT_QUIZ_PASS_PCT },
    );
    // recordCompletion is idempotent: a replay reports alreadyCompleted, and
    // completes the lesson now if the original request died before it did.
    return this.respond(actor, lessonId, attemptId, grade, clientTimestamp);
  }

  private async respond(
    actor: ApiUser,
    lessonId: string,
    attemptId: string,
    grade: ReturnType<typeof gradeQuiz>,
    clientTimestamp: string | null,
  ): Promise<QuizAttemptResponse> {
    const response: QuizAttemptResponse = {
      attemptId,
      scorePct: grade.scorePct,
      passed: grade.passed,
      correctCount: grade.correctCount,
      totalCount: grade.totalCount,
      passThresholdPct: DEFAULT_QUIZ_PASS_PCT,
      perQuestion: grade.perQuestion.map((q) =>
        grade.passed
          ? {
              id: q.id,
              correct: q.correct,
              correctOptionIds: q.correctOptionIds,
              explanation: q.explanation,
            }
          : { id: q.id, correct: q.correct },
      ),
    };

    if (grade.passed) {
      const perfect = grade.scorePct === 100;
      response.completion = await this.progress.recordCompletion({
        userId: actor.userId,
        lessonId,
        xpSource: perfect ? 'QUIZ_PERFECT' : 'LESSON_COMPLETE',
        coinSource: perfect ? 'QUIZ_PERFECT' : 'LESSON_COMPLETE',
        refType: 'quiz',
        refId: attemptId,
        questEvent: 'quiz_pass',
        clientTimestamp,
      });
    }
    return response;
  }

  async listMine(
    actor: ApiUser,
    lessonId: string,
  ): Promise<QuizAttemptSummary[]> {
    const rows = await this.prisma.quizAttempt.findMany({
      where: { userId: actor.userId, lessonId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, scorePct: true, passed: true, createdAt: true },
    });
    return rows.map((r) => ({
      attemptId: r.id,
      scorePct: r.scorePct,
      passed: r.passed,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Published, accessible lesson whose doc contains at least one quiz block. */
  private async loadGradableDoc(
    actor: ApiUser,
    lessonId: string,
  ): Promise<LessonDoc> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      select: {
        contentJson: true,
        module: {
          select: { course: { select: { status: true, deletedAt: true } } },
        },
      },
    });
    if (
      !lesson ||
      lesson.module.course.deletedAt ||
      lesson.module.course.status !== 'PUBLISHED'
    ) {
      throw new NotFoundException('Lesson not found');
    }
    // Same rule as reading and completing the lesson: free, enrolled, or plan.
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
    const doc = migrateLessonDoc(lesson.contentJson as unknown as LessonDoc, {
      validate: null,
    });
    if (extractQuizzes(doc).length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'NO_QUIZ',
        message: 'This lesson has no quiz to grade',
      });
    }
    return doc;
  }
}
