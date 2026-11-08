import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { isExerciseLanguage } from '@codify/domain';
import type { ApiUser } from '../auth/auth.types.js';
import { ExercisesService } from '../exercises/exercises.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveTitles } from './admin-ops.util.js';

export const RETEST_AUDIT_ACTION = 'exercise.bulk_retest';
/** Finished jobs kept in memory per instance (older ones: audit log). */
const MAX_JOBS = 20;
type FailureVerdict = 'FAIL' | 'ERROR' | 'TIMEOUT' | 'MEMORY' | 'RUNTIME';

export interface ExerciseHealthRow {
  exerciseId: string;
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTitle: string;
  language: string;
  /** Scored, graded submissions. */
  attempts: number;
  /** Learners with at least one scored submission. */
  learners: number;
  /** Learners who passed at least once. */
  passers: number;
  /** passers / learners, 0–1 (null with no learners). */
  passRate: number | null;
  /** Mean scored submissions up to and including each passer's first pass. */
  avgAttemptsToPass: number | null;
  /** Failed submissions by verdict (the failure category). */
  failures: Record<FailureVerdict, number>;
  /** Tests failed most often in failing submissions (hidden ones are anonymised `hidden-N`). */
  topFailingTests: { testId: string; name: string; count: number }[];
}

export interface RetestResult {
  exerciseId: string;
  lessonId: string;
  lessonTitle: string;
  ok: boolean;
  verdict: string | null;
  scorePct: number | null;
  message: string | null;
}

export interface RetestJobView {
  jobId: string;
  language: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  actorId: string;
  total: number;
  done: number;
  passed: number;
  failed: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  results: RetestResult[];
}

/**
 * docs/12 §11 admin tools: the per-exercise dashboard (pass rate, attempts
 * to pass, failure categories from `Submission.verdict` + the failing tests
 * in `resultJson`) and the bulk "re-test every exercise in language X"
 * action, which runs each reference solution against all tests through the
 * active executor (`ExercisesService.verifyReference`).
 *
 * Re-test jobs run one at a time per API instance (an in-process queue);
 * progress is visible on that instance, and every finished job is written
 * to the audit log (`exercise.bulk_retest`, full results) so the list
 * survives restarts and shows jobs from every instance.
 */
@Injectable()
export class ExerciseHealthService {
  private readonly logger = new Logger(ExerciseHealthService.name);
  private readonly jobs: RetestJobView[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly exercises: ExercisesService,
  ) {}

  async dashboard(
    locale: string,
    filter: { language?: string },
  ): Promise<{ items: ExerciseHealthRow[]; languages: string[] }> {
    const language = filter.language || null;
    const rows = await this.prisma.$queryRaw<
      {
        exerciseId: string;
        lessonId: string;
        courseId: string;
        courseSlug: string;
        sourceLocale: string;
        language: string;
        attempts: bigint;
        learners: bigint;
        passers: bigint;
        avgAttempts: number | null;
        FAIL: bigint;
        ERROR: bigint;
        TIMEOUT: bigint;
        MEMORY: bigint;
        RUNTIME: bigint;
      }[]
    >`
      WITH s AS (
        SELECT id, "exerciseId", "userId", verdict::text AS verdict, "createdAt"
        FROM "Submission"
        WHERE scored = true AND status::text = 'COMPLETE' AND verdict IS NOT NULL
      ), fp AS (
        SELECT "exerciseId", "userId", MIN("createdAt") AS at
        FROM s WHERE verdict = 'PASS' GROUP BY 1, 2
      ), atp AS (
        SELECT fp."exerciseId", COUNT(s.id)::float AS n
        FROM fp JOIN s ON s."exerciseId" = fp."exerciseId"
          AND s."userId" = fp."userId" AND s."createdAt" <= fp.at
        GROUP BY fp."exerciseId", fp."userId"
      )
      SELECT e.id AS "exerciseId", l.id AS "lessonId", c.id AS "courseId",
        c.slug AS "courseSlug", c."sourceLocale", e.language,
        COUNT(s.id) AS attempts,
        COUNT(DISTINCT s."userId") AS learners,
        (SELECT COUNT(*) FROM fp WHERE fp."exerciseId" = e.id) AS passers,
        (SELECT AVG(n) FROM atp WHERE atp."exerciseId" = e.id) AS "avgAttempts",
        COUNT(s.id) FILTER (WHERE s.verdict = 'FAIL') AS "FAIL",
        COUNT(s.id) FILTER (WHERE s.verdict = 'ERROR') AS "ERROR",
        COUNT(s.id) FILTER (WHERE s.verdict = 'TIMEOUT') AS "TIMEOUT",
        COUNT(s.id) FILTER (WHERE s.verdict = 'MEMORY') AS "MEMORY",
        COUNT(s.id) FILTER (WHERE s.verdict = 'RUNTIME') AS "RUNTIME"
      FROM "Exercise" e
        JOIN "Lesson" l ON l."exerciseId" = e.id
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "Course" c ON c.id = m."courseId"
        LEFT JOIN s ON s."exerciseId" = e.id
      WHERE l."deletedAt" IS NULL AND c."deletedAt" IS NULL
        AND (${language}::text IS NULL OR e.language = ${language})
      GROUP BY e.id, l.id, c.id
      ORDER BY COUNT(s.id) DESC, c.slug ASC, l.id ASC
      LIMIT 500`;
    const ids = rows.map((r) => r.exerciseId);
    const [failing, lessonTitles, courseTitles, languages] = await Promise.all([
      ids.length ? this.failingTests(ids) : new Map(),
      resolveTitles(
        this.prisma,
        'LESSON',
        new Map(rows.map((r) => [r.lessonId, r.sourceLocale])),
        locale,
      ),
      resolveTitles(
        this.prisma,
        'COURSE',
        new Map(rows.map((r) => [r.courseId, r.sourceLocale])),
        locale,
      ),
      this.prisma.exercise.findMany({
        where: { lesson: { deletedAt: null } },
        distinct: ['language'],
        select: { language: true },
        orderBy: { language: 'asc' },
      }),
    ]);
    return {
      languages: languages.map((l) => l.language),
      items: rows.map((r) => {
        const learners = Number(r.learners);
        const passers = Number(r.passers);
        return {
          exerciseId: r.exerciseId,
          lessonId: r.lessonId,
          lessonTitle: lessonTitles.get(r.lessonId) ?? r.lessonId,
          courseId: r.courseId,
          courseTitle: courseTitles.get(r.courseId) ?? r.courseSlug,
          language: r.language,
          attempts: Number(r.attempts),
          learners,
          passers,
          passRate: learners > 0 ? passers / learners : null,
          avgAttemptsToPass:
            r.avgAttempts === null ? null : round1(Number(r.avgAttempts)),
          failures: {
            FAIL: Number(r.FAIL),
            ERROR: Number(r.ERROR),
            TIMEOUT: Number(r.TIMEOUT),
            MEMORY: Number(r.MEMORY),
            RUNTIME: Number(r.RUNTIME),
          },
          topFailingTests: failing.get(r.exerciseId) ?? [],
        };
      }),
    };
  }

  /** Top 3 failed tests per exercise, from the stored per-test results. */
  private async failingTests(
    ids: string[],
  ): Promise<Map<string, ExerciseHealthRow['topFailingTests']>> {
    const rows = await this.prisma.$queryRaw<
      { exerciseId: string; testId: string; name: string; n: bigint }[]
    >`
      SELECT s."exerciseId", r->>'id' AS "testId",
        COALESCE(MAX(r->>'name'), r->>'id') AS name, COUNT(*) AS n
      FROM "Submission" s
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(s."resultJson"->'results') = 'array'
            THEN s."resultJson"->'results' ELSE '[]'::jsonb END) r
      WHERE s."exerciseId" = ANY(${ids}) AND s.scored = true
        AND s.verdict IS NOT NULL AND s.verdict::text <> 'PASS'
        AND (r->>'passed') = 'false' AND r->>'id' IS NOT NULL
      GROUP BY s."exerciseId", r->>'id'
      ORDER BY s."exerciseId", COUNT(*) DESC`;
    const out = new Map<string, ExerciseHealthRow['topFailingTests']>();
    for (const r of rows) {
      const list = out.get(r.exerciseId) ?? [];
      if (list.length < 3)
        list.push({ testId: r.testId, name: r.name, count: Number(r.n) });
      out.set(r.exerciseId, list);
    }
    return out;
  }

  // ─── Bulk re-test ────────────────────────────────────────────────────

  async enqueueRetest(
    actor: ApiUser,
    language: string,
    locale: string,
  ): Promise<RetestJobView> {
    if (!isExerciseLanguage(language))
      throw new BadRequestException({
        code: 'LANGUAGE_NOT_SUPPORTED',
        message: `Unknown exercise language "${language}"`,
      });
    if (
      this.jobs.some(
        (j) =>
          j.language === language &&
          (j.status === 'queued' || j.status === 'running'),
      )
    )
      throw new ConflictException({
        code: 'RETEST_RUNNING',
        message: `A re-test of ${language} exercises is already queued`,
      });
    const exercises = await this.prisma.exercise.findMany({
      where: {
        language,
        lesson: { deletedAt: null, module: { course: { deletedAt: null } } },
      },
      select: {
        id: true,
        lesson: {
          select: {
            id: true,
            module: { select: { course: { select: { sourceLocale: true } } } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    const titles = await resolveTitles(
      this.prisma,
      'LESSON',
      new Map(
        exercises.flatMap((e) =>
          e.lesson
            ? [[e.lesson.id, e.lesson.module.course.sourceLocale] as const]
            : [],
        ),
      ),
      locale,
    );
    const job: RetestJobView = {
      jobId: randomUUID(),
      language,
      status: 'queued',
      actorId: actor.userId,
      total: exercises.length,
      done: 0,
      passed: 0,
      failed: 0,
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      results: [],
    };
    this.jobs.unshift(job);
    this.jobs.splice(MAX_JOBS);
    const targets = exercises.map((e) => ({
      exerciseId: e.id,
      lessonId: e.lesson?.id ?? '',
      lessonTitle: titles.get(e.lesson?.id ?? '') ?? e.lesson?.id ?? e.id,
    }));
    const snapshot = { ...job, results: [] };
    this.chain = this.chain
      .then(() => this.runJob(actor, job, targets))
      .catch(() => undefined);
    return snapshot;
  }

  /** Jobs on this instance (live) + finished jobs from the audit log. */
  async listRetests(): Promise<{ items: RetestJobView[] }> {
    const audited = await this.prisma.auditLog.findMany({
      where: { action: RETEST_AUDIT_ACTION },
      orderBy: { createdAt: 'desc' },
      take: MAX_JOBS,
      select: { diff: true },
    });
    const live = new Set(this.jobs.map((j) => j.jobId));
    const fromAudit = audited
      .map((a) => a.diff as unknown as RetestJobView | null)
      .filter(
        (j): j is RetestJobView => !!j && !!j.jobId && !live.has(j.jobId),
      );
    const items = [...this.jobs, ...fromAudit]
      .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
      .slice(0, MAX_JOBS);
    return { items };
  }

  /** Awaitable for tests: resolves when every queued job has run. */
  idle(): Promise<void> {
    return this.chain;
  }

  private async runJob(
    actor: ApiUser,
    job: RetestJobView,
    targets: { exerciseId: string; lessonId: string; lessonTitle: string }[],
  ): Promise<void> {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    try {
      for (const t of targets) {
        let result: RetestResult;
        try {
          const run = await this.exercises.verifyReference(actor, t.exerciseId);
          result = {
            ...t,
            ok: run.ok,
            verdict: run.verdict,
            scorePct: run.scorePct,
            message: run.ok ? null : (run.message ?? failedNames(run.results)),
          };
        } catch (err) {
          result = {
            ...t,
            ok: false,
            verdict: null,
            scorePct: null,
            message: errorMessage(err),
          };
        }
        job.results.push(result);
        job.done += 1;
        if (result.ok) job.passed += 1;
        else job.failed += 1;
      }
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      job.error = errorMessage(err);
    } finally {
      job.finishedAt = new Date().toISOString();
      this.logger.log(
        `re-test ${job.language}: ${job.passed}/${job.total} reference solutions pass (${job.status})`,
      );
      await this.prisma.auditLog
        .create({
          data: {
            action: RETEST_AUDIT_ACTION,
            actorId: actor.userId,
            actorRole: actor.role,
            entity: 'Exercise',
            entityId: null,
            diff: job as unknown as Prisma.InputJsonValue,
          },
        })
        .catch((err: Error) =>
          this.logger.warn(`re-test audit row failed: ${err.message}`),
        );
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function failedNames(results: { name: string; passed: boolean }[]): string {
  const names = results.filter((r) => !r.passed).map((r) => r.name);
  return names.length ? `Failing: ${names.slice(0, 5).join(', ')}` : 'Failed';
}

function errorMessage(err: unknown): string {
  const res = (err as { getResponse?: () => unknown }).getResponse?.();
  if (res && typeof res === 'object' && 'message' in res)
    return String((res as { message: unknown }).message);
  return (err as Error).message ?? String(err);
}
