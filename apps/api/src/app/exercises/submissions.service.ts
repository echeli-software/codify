import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Submission, SubmissionStatus } from '@prisma/client';
import {
  redactHiddenResults,
  scoreFromResults,
  verdictFromResults,
  type ExecutionErrorKind,
  type StoredTestResult,
  type TestCase,
  type Verdict,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { AccessService } from '../billing/access.service.js';
import { ProgressService } from '../progress/progress.service.js';
import type { RewardResult } from '../gamification/gamification.types.js';
import type { CompletedQuest } from '../gamification/quests.service.js';
import type { UnlockedBadge } from '../gamification/badges.service.js';
import { CODE_EXECUTOR } from './code-execution.provider.js';
import {
  ExecutorUnavailableError,
  type CodeExecutor,
  type RunResponse,
} from './executor.types.js';
import { RateLimitedException, retryAfterSeconds } from './rate-limit.js';
import {
  SUBMISSION_ENQUEUER,
  type SubmissionEnqueuer,
} from './submission-queue.js';
import { toTests } from './exercise-tests.js';

/** docs/12 §7 + docs/14 §7: 1 submission / 3 s per exercise, 200 / day per user. */
export const SUBMIT_COOLDOWN_MS = 3000;
export const SUBMIT_DAILY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RUNTIME_ERROR_MESSAGE =
  'Your code crashed while running the tests. Use "Run" to see the error on the visible tests.';
export const RUNNER_UNAVAILABLE_MESSAGE =
  'The code runner is unavailable right now. Please submit again in a moment.';

export interface SubmissionTimings {
  /** How long POST submit waits for the worker before answering PENDING. */
  waitMs: number;
  pollMs: number;
  /** PENDING/RUNNING rows older than this are marked WORKER_LOST. */
  staleMs: number;
}

export const SUBMISSION_TIMINGS = Symbol('SUBMISSION_TIMINGS');

export function submissionTimingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SubmissionTimings {
  const num = (k: string, d: number) => {
    const n = Number(env[k]);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    waitMs: num('SUBMISSION_WAIT_MS', 10_000),
    pollMs: num('SUBMISSION_POLL_MS', 200),
    staleMs: num('SUBMISSION_STALE_MS', 120_000),
  };
}

/** What the worker stores in Submission.output (JSON) once a run is graded. */
interface StoredOutcome {
  v: 1;
  results: StoredTestResult[];
  errorKind: ExecutionErrorKind;
  /** Student-safe message (never contains hidden-test data). */
  message?: string;
  /** Raw diagnostics for staff only — never returned to students. */
  diagnostics?: string;
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

/** Student-facing submission state (POST submit and GET /submissions/:id). */
export interface SubmissionView {
  submissionId: string;
  /** Same as submissionId (kept for the original GET contract). */
  id: string;
  exerciseId: string;
  status: SubmissionStatus;
  verdict: Verdict | null;
  scorePct: number | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  createdAt: string;
  completedAt: string | null;
  /** Present once status is COMPLETE / WORKER_LOST. */
  passed?: boolean;
  results?: StoredTestResult[];
  hiddenRevealed?: { id: string; name: string }[];
  message?: string;
  reward?: RewardResult;
  questsCompleted?: CompletedQuest[];
  badgesUnlocked?: UnlockedBadge[];
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Asynchronous code submissions (docs/12 §6).
 *
 *   POST submit → Submission(PENDING) → BullMQ job → SubmissionProcessor →
 *   process(): claim PENDING→RUNNING, run visible + hidden tests on the
 *   executor, grade, on pass complete the lesson through
 *   ProgressService.recordCompletion, store the outcome → COMPLETE.
 *
 * The HTTP call waits up to ~10 s for the job, so the common case still
 * returns the full result synchronously; otherwise it answers
 * `{ submissionId, status: 'PENDING' }` and the client polls
 * GET /submissions/:id. Without Redis in development the job runs inline.
 * A sweeper marks rows stuck in PENDING/RUNNING as WORKER_LOST.
 */
@Injectable()
export class SubmissionsService {
  private readonly log = new Logger('Submissions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly progress: ProgressService,
    @Inject(CODE_EXECUTOR) private readonly executor: CodeExecutor,
    @Inject(SUBMISSION_ENQUEUER) private readonly enqueuer: SubmissionEnqueuer,
    @Inject(SUBMISSION_TIMINGS) private readonly timings: SubmissionTimings,
  ) {}

  // ─── Submit ────────────────────────────────────────────────────────────

  async submit(
    userId: string,
    exerciseId: string,
    code: string,
    idempotencyKey?: string | null,
  ): Promise<SubmissionView> {
    const storedKey = this.scopedKey(userId, idempotencyKey);
    if (storedKey) {
      const replay = await this.replay(userId, exerciseId, code, storedKey);
      if (replay) return replay;
    }

    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true, language: true, lesson: { select: { id: true } } },
    });
    if (!exercise?.lesson) throw new NotFoundException('Exercise not found');
    const { access } = await this.access.resolveLessonAccess(
      userId,
      exercise.lesson.id,
    );
    if (!access.granted)
      throw new ForbiddenException('Subscription required for this lesson');
    if (!this.executor.supportedLanguages.includes(exercise.language)) {
      throw new BadRequestException({
        code: 'LANGUAGE_NOT_SUPPORTED',
        message: `The code runner cannot run ${exercise.language} right now.`,
      });
    }

    await this.assertWithinLimits(userId, exerciseId);

    let submission: Submission;
    try {
      submission = await this.prisma.submission.create({
        data: {
          userId,
          exerciseId,
          code,
          status: 'PENDING',
          scored: true,
          idempotencyKey: storedKey,
        },
      });
    } catch (err) {
      // A concurrent request with the same Idempotency-Key won the race.
      if (storedKey && isUniqueViolation(err)) {
        const replay = await this.replay(userId, exerciseId, code, storedKey);
        if (replay) return replay;
      }
      throw err;
    }

    const queued = await this.enqueuer.enqueue(submission.id);
    if (!queued) {
      if (process.env['NODE_ENV'] === 'production') {
        await this.markLost(submission.id);
        throw new ServiceUnavailableException(RUNNER_UNAVAILABLE_MESSAGE);
      }
      this.log.warn(
        `Submission queue unreachable (REDIS_URL) — running ${submission.id} inline (dev fallback).`,
      );
      await this.process(submission.id);
    }
    return this.waitForResult(submission.id);
  }

  /** Student view of one of their submissions. */
  async get(userId: string, id: string): Promise<SubmissionView> {
    const s = await this.prisma.submission.findUnique({ where: { id } });
    if (!s || s.userId !== userId)
      throw new NotFoundException('Submission not found');
    return toView(s);
  }

  // ─── Worker ────────────────────────────────────────────────────────────

  /**
   * Grade one submission. Safe to call more than once (only the caller that
   * flips PENDING → RUNNING does the work), so queue redelivery or the inline
   * fallback can never grade or reward twice.
   */
  async process(submissionId: string): Promise<void> {
    const claimed = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: 'PENDING' },
      data: { status: 'RUNNING' },
    });
    if (claimed.count === 0) return;

    const sub = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { exercise: { include: { lesson: { select: { id: true } } } } },
    });
    if (!sub) return;
    const ex = sub.exercise;
    const visible = toTests(ex.visibleTestsJson);
    const hidden = toTests(ex.hiddenTestsJson);
    const tests: TestCase[] = [...visible, ...hidden];

    let run: RunResponse;
    let infraFailure = false;
    try {
      run = await this.executor.run({
        language: ex.language,
        code: sub.code,
        entryFunction: ex.entryFunction,
        tests,
        timeLimitMs: ex.timeLimitMs,
        memoryLimitKb: ex.memoryLimitKb,
        testHarness: ex.testHarness,
      });
    } catch (err) {
      infraFailure = true;
      if (!(err instanceof ExecutorUnavailableError))
        this.log.error(`executor crashed on ${submissionId}`, err as Error);
      else
        this.log.warn(
          `executor unavailable for ${submissionId}: ${err.message}`,
        );
      run = {
        results: tests.map((t) => ({
          id: t.id,
          name: t.name,
          passed: false,
          error: 'Not run',
        })),
        errorKind: 'error',
        runtimeMs: 0,
        output: (err as Error).message,
      };
    }

    // Executors return results in request order: visible first, then hidden.
    const results: StoredTestResult[] = run.results.map((r, i) => ({
      ...compactResult(r),
      hidden: i >= visible.length,
    }));
    const verdict = verdictFromResults(results, run.errorKind);
    const passed = verdict === 'PASS';

    const outcome: StoredOutcome = {
      v: 1,
      results,
      errorKind: run.errorKind,
      message: studentMessage(run, infraFailure),
      diagnostics: run.output?.slice(0, 4000),
    };

    if (passed && ex.lesson) {
      try {
        const done = await this.progress.recordCompletion({
          userId: sub.userId,
          lessonId: ex.lesson.id,
          xpSource: 'EXERCISE_PASS',
          coinSource: 'EXERCISE_PASS',
          refType: 'exercise',
          refId: ex.id,
          questEvent: 'exercise_pass',
        });
        if (!done.alreadyCompleted) {
          outcome.reward = done.reward;
          outcome.questsCompleted = done.questsCompleted;
          outcome.badgesUnlocked = done.badgesUnlocked;
        }
      } catch (err) {
        this.log.error(
          `recordCompletion failed for submission ${submissionId}`,
          err as Error,
        );
      }
    }

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'COMPLETE',
        verdict,
        scorePct: scoreFromResults(results),
        runtimeMs: Math.round(run.runtimeMs),
        memoryKb: run.memoryKb ?? null,
        output: serializeOutcome(outcome),
        completedAt: new Date(),
      },
    });
  }

  /** Reconciliation (docs/12 §6): jobs whose worker died never finish. Run by SubmissionSweeper. */
  async sweepStale(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - this.timings.staleMs);
    const res = await this.prisma.submission.updateMany({
      where: {
        status: { in: ['PENDING', 'RUNNING'] },
        createdAt: { lt: cutoff },
      },
      data: {
        status: 'WORKER_LOST',
        verdict: 'ERROR',
        completedAt: new Date(now),
        output: serializeOutcome({
          v: 1,
          results: [],
          errorKind: 'error',
          message: RUNNER_UNAVAILABLE_MESSAGE,
        }),
      },
    });
    if (res.count)
      this.log.warn(`marked ${res.count} stale submission(s) WORKER_LOST`);
    return res.count;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private scopedKey(
    userId: string,
    key: string | null | undefined,
  ): string | null {
    if (!key) return null;
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be 8–128 characters of [A-Za-z0-9_.:-]',
      });
    }
    // Keys are only unique per user; scope them so users cannot collide.
    return `${userId}:${key}`;
  }

  private async replay(
    userId: string,
    exerciseId: string,
    code: string,
    storedKey: string,
  ): Promise<SubmissionView | null> {
    const prior = await this.prisma.submission.findUnique({
      where: { idempotencyKey: storedKey },
    });
    if (!prior || prior.userId !== userId) return null;
    if (prior.exerciseId !== exerciseId || prior.code !== code) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This Idempotency-Key was already used for a different submission',
      });
    }
    return this.waitForResult(prior.id);
  }

  private async assertWithinLimits(
    userId: string,
    exerciseId: string,
  ): Promise<void> {
    const now = Date.now();
    const last = await this.prisma.submission.findFirst({
      where: { userId, exerciseId, scored: true },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const cooldown = last
      ? retryAfterSeconds([last.createdAt], 1, SUBMIT_COOLDOWN_MS, now)
      : 0;
    if (cooldown > 0) {
      throw new RateLimitedException(
        'Slow down — one submission every few seconds',
        cooldown,
        'SUBMIT_COOLDOWN',
      );
    }
    const recent = await this.prisma.submission.findMany({
      where: {
        userId,
        scored: true,
        createdAt: { gte: new Date(now - DAY_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: SUBMIT_DAILY_LIMIT,
      select: { createdAt: true },
    });
    const daily = retryAfterSeconds(
      recent.map((r) => r.createdAt),
      SUBMIT_DAILY_LIMIT,
      DAY_MS,
      now,
    );
    if (daily > 0)
      throw new RateLimitedException(
        `Daily limit of ${SUBMIT_DAILY_LIMIT} submissions reached`,
        daily,
        'SUBMIT_DAILY_LIMIT',
      );
  }

  private async waitForResult(id: string): Promise<SubmissionView> {
    const deadline = Date.now() + this.timings.waitMs;
    for (;;) {
      const s = await this.prisma.submission.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('Submission not found');
      if (
        s.status === 'COMPLETE' ||
        s.status === 'WORKER_LOST' ||
        Date.now() >= deadline
      )
        return toView(s);
      await new Promise((r) => setTimeout(r, this.timings.pollMs));
    }
  }

  private async markLost(id: string): Promise<void> {
    await this.prisma.submission.update({
      where: { id },
      data: {
        status: 'WORKER_LOST',
        verdict: 'ERROR',
        completedAt: new Date(),
        output: serializeOutcome({
          v: 1,
          results: [],
          errorKind: 'error',
          message: RUNNER_UNAVAILABLE_MESSAGE,
        }),
      },
    });
  }
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────

function studentMessage(
  run: RunResponse,
  infraFailure: boolean,
): string | undefined {
  if (infraFailure) return RUNNER_UNAVAILABLE_MESSAGE;
  switch (run.errorKind) {
    case 'error':
      // Compile errors happen before any test input exists in the process.
      return run.output || 'Your code could not be compiled.';
    case 'timeout':
    case 'memory':
      return run.output;
    case 'runtime':
      // stderr may echo hidden-test arguments — never show it on submit.
      return RUNTIME_ERROR_MESSAGE;
    default:
      return undefined;
  }
}

/** Keep stored results small: large actual/expected values become previews. */
function compactResult(r: StoredTestResult): StoredTestResult {
  const out: StoredTestResult = { ...r };
  for (const k of ['actual', 'expected'] as const) {
    if (out[k] === undefined) continue;
    const json = JSON.stringify(out[k]) ?? 'undefined';
    if (json.length > 2000) out[k] = `${json.slice(0, 2000)}… (truncated)`;
  }
  if (out.error && out.error.length > 1000)
    out.error = `${out.error.slice(0, 1000)}…`;
  return out;
}

function serializeOutcome(o: StoredOutcome): string {
  const json = JSON.stringify(o);
  if (json.length <= 256_000) return json;
  return JSON.stringify({
    ...o,
    results: o.results.map(({ actual: _a, expected: _e, ...rest }) => rest),
  });
}

export function parseOutcome(output: string | null): StoredOutcome | null {
  if (!output || output[0] !== '{') return null;
  try {
    const o = JSON.parse(output) as StoredOutcome;
    return o && o.v === 1 && Array.isArray(o.results) ? o : null;
  } catch {
    return null;
  }
}

export function toView(s: Submission): SubmissionView {
  const view: SubmissionView = {
    submissionId: s.id,
    id: s.id,
    exerciseId: s.exerciseId,
    status: s.status,
    verdict: (s.verdict as Verdict | null) ?? null,
    scorePct: s.scorePct,
    runtimeMs: s.runtimeMs,
    memoryKb: s.memoryKb,
    createdAt: s.createdAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
  };
  if (s.status !== 'COMPLETE' && s.status !== 'WORKER_LOST') return view;
  const outcome = parseOutcome(s.output);
  const passed = s.verdict === 'PASS';
  view.passed = passed;
  view.results = outcome ? redactHiddenResults(outcome.results, passed) : [];
  view.hiddenRevealed =
    passed && outcome
      ? outcome.results
          .filter((r) => r.hidden)
          .map((r) => ({ id: r.id, name: r.name }))
      : [];
  if (outcome?.message) view.message = outcome.message;
  if (outcome?.reward) {
    view.reward = outcome.reward;
    view.questsCompleted = outcome.questsCompleted;
    view.badgesUnlocked = outcome.badgesUnlocked;
  }
  return view;
}
