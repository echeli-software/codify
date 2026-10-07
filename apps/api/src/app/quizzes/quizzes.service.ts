import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
  ): Promise<QuizAttemptResponse> {
    const clientTimestamp = validateClientTimestamp(body.clientTimestamp);
    const doc = await this.loadGradableDoc(actor, lessonId);

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

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        userId: actor.userId,
        lessonId,
        answersJson: answers as Prisma.InputJsonValue,
        scorePct: grade.scorePct,
        passed: grade.passed,
      },
      select: { id: true },
    });

    const response: QuizAttemptResponse = {
      attemptId: attempt.id,
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
        refId: attempt.id,
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
