import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Exercise, Prisma } from '@prisma/client';
import {
  isExerciseLanguage,
  scoreFromResults,
  verdictFromResults,
  type TestCase,
  type TestResult,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  assertCanManageAttached,
  lessonForAuthor,
} from '../courses/course-ownership.js';
import { CODE_EXECUTOR } from './code-execution.provider.js';
import {
  ExecutorUnavailableError,
  type CodeExecutor,
  type RunResponse,
} from './executor.types.js';
import { toTests, validateTestCases } from './exercise-tests.js';

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
  visibleTests: {
    id: string;
    name: string;
    args: unknown[];
    expected: unknown;
  }[];
  alreadyPassed: boolean;
}

/** "Run" (visible tests only) and the admin reference check. */
export interface RunResult {
  results: TestResult[];
  verdict: string;
  scorePct: number;
  /** Compiler / runtime diagnostics (visible tests only, so safe to show). */
  message?: string;
  /** What the code printed (non-protocol stdout), truncated. */
  stdout?: string;
}

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    @Inject(CODE_EXECUTOR) private readonly executor: CodeExecutor,
  ) {}

  // ─── Admin (ADMIN, or the TEACHER who authors the course) ──────────────

  async createForLesson(
    actor: ApiUser,
    lessonId: string,
    input: ExerciseInput,
  ): Promise<Exercise> {
    const lesson = await lessonForAuthor(this.prisma, actor, lessonId);
    if (lesson.exerciseId)
      throw new BadRequestException('Lesson already has an exercise');
    this.validate(input);

    return this.prisma.$transaction(async (tx) => {
      const exercise = await tx.exercise.create({ data: this.toData(input) });
      await tx.lesson.update({
        where: { id: lessonId },
        data: { exerciseId: exercise.id, type: 'EXERCISE' },
      });
      return exercise;
    });
  }

  async update(
    actor: ApiUser,
    id: string,
    patch: Partial<ExerciseInput>,
  ): Promise<Exercise> {
    const ex = await this.prisma.exercise.findUnique({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    await assertCanManageAttached(this.prisma, actor, { exerciseId: id });
    this.validate({
      language: patch.language ?? ex.language,
      visibleTests: patch.visibleTests,
      hiddenTests: patch.hiddenTests,
    });
    return this.prisma.exercise.update({
      where: { id },
      data: this.toData(patch, true),
    });
  }

  /** Full exercise incl. reference solution + hidden tests — owners only. */
  async getAdmin(actor: ApiUser, id: string): Promise<Exercise> {
    const ex = await this.prisma.exercise.findUnique({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    await assertCanManageAttached(this.prisma, actor, { exerciseId: id });
    return ex;
  }

  /** The exercise attached to a lesson (admin), or null if none yet. */
  async getAdminByLesson(
    actor: ApiUser,
    lessonId: string,
  ): Promise<Exercise | null> {
    const lesson = await lessonForAuthor(this.prisma, actor, lessonId);
    if (!lesson.exerciseId) return null;
    return this.prisma.exercise.findUnique({
      where: { id: lesson.exerciseId },
    });
  }

  /** Run the reference solution against every test — it must all pass. */
  async verifyReference(
    actor: ApiUser,
    id: string,
  ): Promise<RunResult & { ok: boolean }> {
    const ex = await this.getAdmin(actor, id);
    this.assertRunnable(ex.language);
    const run = await this.execute(ex, ex.solutionCode, [
      ...toTests(ex.visibleTestsJson),
      ...toTests(ex.hiddenTestsJson),
    ]);
    const verdict = verdictFromResults(run.results, run.errorKind);
    return { ...toRunResult(run), ok: verdict === 'PASS' };
  }

  // ─── Student ────────────────────────────────────────────────────────────

  async getForStudent(
    userId: string,
    lessonId: string,
  ): Promise<StudentExerciseView> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, deletedAt: null },
      include: {
        exercise: true,
        module: { include: { course: { select: { status: true } } } },
      },
    });
    if (
      !lesson ||
      !lesson.exercise ||
      lesson.module.course.status !== 'PUBLISHED'
    )
      throw new NotFoundException('No exercise for this lesson');
    await this.assertAccess(userId, lessonId);
    const ex = lesson.exercise;
    const passed = await this.prisma.submission.findFirst({
      where: { userId, exerciseId: ex.id, verdict: 'PASS' },
      select: { id: true },
    });
    return {
      id: ex.id,
      lessonId,
      language: ex.language,
      entryFunction: ex.entryFunction,
      starterCode: ex.starterCode,
      visibleTests: toTests(ex.visibleTestsJson).map(
        ({ id, name, args, expected }) => ({ id, name, args, expected }),
      ),
      alreadyPassed: !!passed,
    };
  }

  /** "Run" — visible tests only, synchronous, no score persisted, no reward. */
  async run(
    userId: string,
    exerciseId: string,
    code: string,
  ): Promise<RunResult> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { lesson: { select: { id: true } } },
    });
    if (!exercise?.lesson) throw new NotFoundException('Exercise not found');
    await this.assertAccess(userId, exercise.lesson.id);
    this.assertRunnable(exercise.language);
    return toRunResult(
      await this.execute(exercise, code, toTests(exercise.visibleTestsJson)),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async execute(
    ex: Exercise,
    code: string,
    tests: TestCase[],
  ): Promise<RunResponse> {
    try {
      return await this.executor.run({
        language: ex.language,
        code,
        entryFunction: ex.entryFunction,
        tests,
        timeLimitMs: ex.timeLimitMs,
        memoryLimitKb: ex.memoryLimitKb,
        testHarness: ex.testHarness,
      });
    } catch (err) {
      if (err instanceof ExecutorUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'RUNNER_UNAVAILABLE',
          message:
            'The code runner is unavailable right now. Try again in a moment.',
        });
      }
      throw err;
    }
  }

  private assertRunnable(language: string): void {
    if (!this.executor.supportedLanguages.includes(language)) {
      throw new BadRequestException({
        code: 'LANGUAGE_NOT_SUPPORTED',
        message: `The active code runner (${this.executor.mode}) cannot run ${language}. Supported: ${this.executor.supportedLanguages.join(', ')}.`,
      });
    }
  }

  private validate(
    input: Partial<
      Pick<ExerciseInput, 'language' | 'visibleTests' | 'hiddenTests'>
    >,
  ): void {
    if (input.language !== undefined) {
      if (!isExerciseLanguage(input.language))
        throw new BadRequestException({
          code: 'LANGUAGE_NOT_SUPPORTED',
          message: `Unsupported language "${input.language}"`,
        });
      this.assertRunnable(input.language);
    }
    const errors = validateTestCases(input.visibleTests, input.hiddenTests);
    if (errors.length)
      throw new BadRequestException({
        code: 'INVALID_TESTS',
        message: `Invalid tests: ${errors.join('; ')}`,
        errors,
      });
  }

  private toData(
    input: Partial<ExerciseInput>,
    partial = false,
  ): Prisma.ExerciseUncheckedCreateInput {
    const data: Record<string, unknown> = {};
    if (input.language !== undefined) data['language'] = input.language;
    if (input.entryFunction !== undefined)
      data['entryFunction'] = input.entryFunction;
    if (input.starterCode !== undefined)
      data['starterCode'] = input.starterCode;
    if (input.solutionCode !== undefined)
      data['solutionCode'] = input.solutionCode;
    if (input.testHarness !== undefined)
      data['testHarness'] = input.testHarness;
    if (input.timeLimitMs !== undefined)
      data['timeLimitMs'] = input.timeLimitMs;
    if (input.memoryLimitKb !== undefined)
      data['memoryLimitKb'] = input.memoryLimitKb;
    if (input.visibleTests !== undefined)
      data['visibleTestsJson'] =
        input.visibleTests as unknown as Prisma.InputJsonValue;
    if (input.hiddenTests !== undefined)
      data['hiddenTestsJson'] =
        input.hiddenTests as unknown as Prisma.InputJsonValue;
    if (!partial) {
      data['visibleTestsJson'] ??= [];
      data['hiddenTestsJson'] ??= [];
    }
    return data as Prisma.ExerciseUncheckedCreateInput;
  }

  private async assertAccess(userId: string, lessonId: string): Promise<void> {
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted)
      throw new ForbiddenException('Subscription required for this lesson');
  }
}

function toRunResult(run: RunResponse): RunResult {
  const out: RunResult = {
    results: run.results,
    verdict: verdictFromResults(run.results, run.errorKind),
    scorePct: scoreFromResults(run.results),
  };
  if (run.output) out.message = run.output;
  if (run.studentOutput) out.stdout = run.studentOutput;
  return out;
}
