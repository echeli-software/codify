import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Exercise, Prisma } from '@prisma/client';
import { scoreFromResults, verdictFromResults, type TestCase, type TestResult } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { QuestsService } from '../gamification/quests.service.js';
import { BadgesService } from '../gamification/badges.service.js';
import type { RewardResult } from '../gamification/gamification.types.js';
import { CODE_EXECUTOR, type CodeExecutor } from './code-execution.provider.js';

const SUBMIT_COOLDOWN_MS = 3000;

export interface ExerciseInput {
  language: string;
  entryFunction: string;
  starterCode: string;
  solutionCode: string;
  visibleTests: TestCase[];
  hiddenTests: TestCase[];
  timeLimitMs?: number;
  memoryLimitKb?: number;
  testHarness?: string;
}

export interface StudentExerciseView {
  id: string;
  lessonId: string;
  language: string;
  entryFunction: string;
  starterCode: string;
  visibleTests: { id: string; name: string; args: unknown[]; expected: unknown }[];
  alreadyPassed: boolean;
}

export interface RunResult {
  results: TestResult[];
  verdict: string;
  scorePct: number;
}

export interface SubmitResult extends RunResult {
  submissionId: string;
  passed: boolean;
  hiddenRevealed: { id: string; name: string }[];
  reward?: RewardResult;
  questsCompleted?: { id: string; title: string }[];
  badgesUnlocked?: { id: string; slug: string; name: string }[];
}

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gamification: GamificationService,
    private readonly quests: QuestsService,
    private readonly badges: BadgesService,
    @Inject(CODE_EXECUTOR) private readonly executor: CodeExecutor,
  ) {}

  // ─── Admin ──────────────────────────────────────────────────────────────

  async createForLesson(lessonId: string, input: ExerciseInput): Promise<Exercise> {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, deletedAt: null } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (lesson.exerciseId) throw new BadRequestException('Lesson already has an exercise');

    return this.prisma.$transaction(async (tx) => {
      const exercise = await tx.exercise.create({ data: this.toData(input) });
      await tx.lesson.update({ where: { id: lessonId }, data: { exerciseId: exercise.id, type: 'EXERCISE' } });
      return exercise;
    });
  }

  async update(id: string, patch: Partial<ExerciseInput>): Promise<Exercise> {
    const ex = await this.prisma.exercise.findUnique({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    return this.prisma.exercise.update({ where: { id }, data: this.toData(patch, true) });
  }

  getAdmin(id: string): Promise<Exercise> {
    return this.prisma.exercise.findUniqueOrThrow({ where: { id } });
  }

  /** Run the reference solution against every test — it must all pass. */
  async verifyReference(id: string): Promise<RunResult & { ok: boolean }> {
    const ex = await this.prisma.exercise.findUniqueOrThrow({ where: { id } });
    const tests = [...toTests(ex.visibleTestsJson), ...toTests(ex.hiddenTestsJson)];
    const run = await this.executor.run({
      language: ex.language,
      code: ex.solutionCode,
      entryFunction: ex.entryFunction,
      tests,
      timeLimitMs: ex.timeLimitMs,
    });
    const verdict = verdictFromResults(run.results, run.errorKind);
    return { results: run.results, verdict, scorePct: scoreFromResults(run.results), ok: verdict === 'PASS' };
  }

  // ─── Student ────────────────────────────────────────────────────────────

  async getForStudent(userId: string, lessonId: string): Promise<StudentExerciseView> {
    const lesson = await this.lessonWithExercise(lessonId);
    await this.assertAccess(userId, lessonId);
    const ex = lesson.exercise!;
    const passed = await this.prisma.submission.findFirst({ where: { userId, exerciseId: ex.id, verdict: 'PASS' }, select: { id: true } });
    return {
      id: ex.id,
      lessonId,
      language: ex.language,
      entryFunction: ex.entryFunction,
      starterCode: ex.starterCode,
      visibleTests: toTests(ex.visibleTestsJson).map(({ id, name, args, expected }) => ({ id, name, args, expected })),
      alreadyPassed: !!passed,
    };
  }

  /** "Run" — visible tests only, no score, no reward (not persisted as scored). */
  async run(userId: string, exerciseId: string, code: string): Promise<RunResult> {
    const { exercise, lessonId } = await this.exerciseWithLesson(exerciseId);
    await this.assertAccess(userId, lessonId);
    const run = await this.executor.run({
      language: exercise.language,
      code,
      entryFunction: exercise.entryFunction,
      tests: toTests(exercise.visibleTestsJson),
      timeLimitMs: exercise.timeLimitMs,
    });
    const verdict = verdictFromResults(run.results, run.errorKind);
    return { results: run.results, verdict, scorePct: scoreFromResults(run.results) };
  }

  /** "Submit" — visible + hidden, scored, reward on first pass. */
  async submit(userId: string, exerciseId: string, code: string): Promise<SubmitResult> {
    const { exercise, lesson } = await this.exerciseWithLesson(exerciseId);
    await this.assertAccess(userId, lesson.id);

    const recent = await this.prisma.submission.findFirst({
      where: { userId, exerciseId, scored: true },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < SUBMIT_COOLDOWN_MS) {
      throw new HttpException('Slow down — one submission every few seconds', 429);
    }

    const visible = toTests(exercise.visibleTestsJson);
    const hidden = toTests(exercise.hiddenTestsJson);
    const run = await this.executor.run({
      language: exercise.language,
      code,
      entryFunction: exercise.entryFunction,
      tests: [...visible, ...hidden],
      timeLimitMs: exercise.timeLimitMs,
    });
    const verdict = verdictFromResults(run.results, run.errorKind);
    const scorePct = scoreFromResults(run.results);
    const passed = verdict === 'PASS';

    const priorPass = await this.prisma.submission.findFirst({ where: { userId, exerciseId, verdict: 'PASS' }, select: { id: true } });
    const firstPass = passed && !priorPass;

    const submission = await this.prisma.submission.create({
      data: {
        userId,
        exerciseId,
        code,
        status: 'COMPLETE',
        verdict,
        scorePct,
        runtimeMs: run.runtimeMs,
        scored: true,
        output: passed ? null : (run.output ?? JSON.stringify(run.results.filter((r) => !r.passed))).slice(0, 8000),
        completedAt: new Date(),
      },
    });

    const result: SubmitResult = {
      submissionId: submission.id,
      results: run.results,
      verdict,
      scorePct,
      passed,
      // Hidden test names are revealed only on a full pass (docs §6).
      hiddenRevealed: passed ? hidden.map((h) => ({ id: h.id, name: h.name })) : [],
    };

    if (firstPass) {
      const out = await this.grantFirstPass(userId, lesson, exerciseId);
      result.reward = out.reward;
      result.questsCompleted = out.questsCompleted;
      result.badgesUnlocked = out.badgesUnlocked;
    }
    return result;
  }

  async getSubmission(userId: string, id: string) {
    const s = await this.prisma.submission.findUnique({ where: { id } });
    if (!s || s.userId !== userId) throw new NotFoundException('Submission not found');
    return {
      id: s.id,
      status: s.status,
      verdict: s.verdict,
      scorePct: s.scorePct,
      runtimeMs: s.runtimeMs,
      createdAt: s.createdAt.toISOString(),
    };
  }

  // ─── Reward on first pass (mirrors lesson completion) ────────────────────

  private async grantFirstPass(
    userId: string,
    lesson: { id: string; baseXp: number; baseCoins: number; module: { courseId: string } },
    exerciseId: string,
  ) {
    const courseId = lesson.module.courseId;
    const cats = await this.prisma.courseCategory.findMany({ where: { courseId }, select: { categoryId: true } });
    const categoryIds = cats.map((c) => c.categoryId);

    return this.prisma.$transaction(async (tx) => {
      // Mark the lesson complete (idempotent on the (userId, lessonId) unique).
      const existing = await tx.progress.findUnique({ where: { userId_lessonId: { userId, lessonId: lesson.id } } });
      if (!existing) {
        await tx.progress.create({ data: { userId, lessonId: lesson.id, xpAwarded: 0, coinsAwarded: 0 } });
      }
      const reward = await this.gamification.grantReward(
        {
          userId,
          baseXp: lesson.baseXp,
          baseCoins: lesson.baseCoins,
          xpSource: 'EXERCISE_PASS',
          coinSource: 'EXERCISE_PASS',
          refType: 'exercise',
          refId: exerciseId,
          idempotencyKey: `exercise_pass:${userId}:${exerciseId}`,
          courseId,
          lessonId: lesson.id,
          countsForStreak: true,
        },
        tx,
      );
      if (!existing) {
        await tx.progress.update({ where: { userId_lessonId: { userId, lessonId: lesson.id } }, data: { xpAwarded: reward.xp, coinsAwarded: reward.coins } });
      }
      const questsCompleted = await this.quests.onEvent(tx, userId, { type: 'exercise_pass', courseId, categoryIds });
      const badgesUnlocked = await this.badges.evaluate(tx, userId);
      return { reward, questsCompleted, badgesUnlocked };
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private toData(input: Partial<ExerciseInput>, partial = false): Prisma.ExerciseUncheckedCreateInput {
    const data: Record<string, unknown> = {};
    if (input.language !== undefined) data['language'] = input.language;
    if (input.entryFunction !== undefined) data['entryFunction'] = input.entryFunction;
    if (input.starterCode !== undefined) data['starterCode'] = input.starterCode;
    if (input.solutionCode !== undefined) data['solutionCode'] = input.solutionCode;
    if (input.testHarness !== undefined) data['testHarness'] = input.testHarness;
    if (input.timeLimitMs !== undefined) data['timeLimitMs'] = input.timeLimitMs;
    if (input.memoryLimitKb !== undefined) data['memoryLimitKb'] = input.memoryLimitKb;
    if (input.visibleTests !== undefined) data['visibleTestsJson'] = input.visibleTests as unknown as Prisma.InputJsonValue;
    if (input.hiddenTests !== undefined) data['hiddenTestsJson'] = input.hiddenTests as unknown as Prisma.InputJsonValue;
    if (!partial) {
      data['visibleTestsJson'] ??= [];
      data['hiddenTestsJson'] ??= [];
    }
    return data as Prisma.ExerciseUncheckedCreateInput;
  }

  private async lessonWithExercise(lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: { exercise: true, module: { include: { course: true } } },
    });
    if (!lesson || !lesson.exercise) throw new NotFoundException('No exercise for this lesson');
    if (lesson.module.course.status !== 'PUBLISHED') throw new NotFoundException('Lesson not available');
    return lesson;
  }

  private async exerciseWithLesson(exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { lesson: { include: { module: { include: { course: true } } } } },
    });
    if (!exercise || !exercise.lesson) throw new NotFoundException('Exercise not found');
    return { exercise, lesson: exercise.lesson, lessonId: exercise.lesson.id };
  }

  private async assertAccess(userId: string, lessonId: string): Promise<void> {
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted) {
      throw new ForbiddenException('Subscription required for this lesson');
    }
  }
}

function toTests(json: unknown): TestCase[] {
  if (!Array.isArray(json)) return [];
  return json.map((t, i) => {
    const o = t as Record<string, unknown>;
    return {
      id: typeof o['id'] === 'string' ? (o['id'] as string) : `t${i}`,
      name: typeof o['name'] === 'string' ? (o['name'] as string) : `Test ${i + 1}`,
      args: Array.isArray(o['args']) ? (o['args'] as unknown[]) : [],
      expected: o['expected'],
    };
  });
}
