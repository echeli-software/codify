import { Prisma, type Submission } from '@prisma/client';
import { HIDDEN_TEST_FAILED_MESSAGE } from '@codify/domain';
import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProgressService } from '../progress/progress.service.js';
import type {
  CodeExecutor,
  RunRequest,
  RunResponse,
} from './executor.types.js';
import { ExecutorUnavailableError } from './executor.types.js';
import { RateLimitedException } from './rate-limit.js';
import {
  RUNTIME_ERROR_MESSAGE,
  RUNNER_UNAVAILABLE_MESSAGE,
  SubmissionsService,
} from './submissions.service.js';

const EXERCISE = {
  id: 'ex1',
  language: 'javascript',
  entryFunction: 'solution',
  timeLimitMs: 2000,
  memoryLimitKb: 128000,
  testHarness: '',
  visibleTestsJson: [{ id: 'v1', name: 'adds', args: [1, 2], expected: 3 }],
  hiddenTestsJson: [
    { id: 'h-secret', name: 'secret negatives', args: [-40, 2], expected: -38 },
  ],
  lesson: { id: 'lesson1' },
};

/** Tiny in-memory Submission table with the unique idempotencyKey constraint. */
function fakePrisma() {
  const rows: Submission[] = [];
  let seq = 0;
  const match = (s: Submission, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const val = (s as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'in' in (v as object))
        return (v as { in: unknown[] }).in.includes(val);
      if (v && typeof v === 'object' && 'gte' in (v as object))
        return (val as Date) >= (v as { gte: Date }).gte;
      if (v && typeof v === 'object' && 'lt' in (v as object))
        return (val as Date) < (v as { lt: Date }).lt;
      return val === v;
    });
  const submission = {
    findUnique: jest.fn(
      async ({
        where,
        include,
      }: {
        where: { id?: string; idempotencyKey?: string };
        include?: unknown;
      }) => {
        const row = rows.find((r) =>
          where.id
            ? r.id === where.id
            : r.idempotencyKey === where.idempotencyKey,
        );
        if (!row) return null;
        return include ? { ...row, exercise: EXERCISE } : { ...row };
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        const found = rows
          .filter((r) => match(r, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return found[0] ?? null;
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take?: number;
      }) =>
        rows
          .filter((r) => match(r, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take ?? Infinity),
    ),
    create: jest.fn(async ({ data }: { data: Partial<Submission> }) => {
      if (
        data.idempotencyKey &&
        rows.some((r) => r.idempotencyKey === data.idempotencyKey)
      ) {
        throw new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const row = {
        id: `sub${++seq}`,
        status: 'PENDING',
        verdict: null,
        runtimeMs: null,
        memoryKb: null,
        output: null,
        scorePct: null,
        scored: true,
        idempotencyKey: null,
        createdAt: new Date(),
        completedAt: null,
        ...data,
      } as Submission;
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Submission>;
      }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Submission>;
      }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    ),
  };
  const prisma = {
    submission,
    exercise: {
      findUnique: jest.fn(async () => ({
        id: EXERCISE.id,
        language: EXERCISE.language,
        lesson: EXERCISE.lesson,
      })),
    },
  };
  return { prisma: prisma as unknown as PrismaService, rows, submission };
}

function setup(
  opts: {
    queued?: boolean;
    run?: (req: RunRequest) => Promise<RunResponse>;
    alreadyCompleted?: boolean;
  } = {},
) {
  const db = fakePrisma();
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  const recordCompletion = jest.fn(async () => ({
    alreadyCompleted: opts.alreadyCompleted ?? false,
    progress: {
      lessonId: 'lesson1',
      completedAt: new Date().toISOString(),
      xpAwarded: 25,
      coinsAwarded: 12,
    },
    totals: { totalXp: 25, coins: 12 },
    reward: opts.alreadyCompleted ? undefined : { xp: 25, coins: 12 },
    questsCompleted: [],
    badgesUnlocked: [],
  }));
  const progress = { recordCompletion } as unknown as ProgressService;
  const run = jest.fn(
    opts.run ??
      (async (req: RunRequest): Promise<RunResponse> => ({
        results: req.tests.map((t) => ({
          id: t.id,
          name: t.name,
          passed: true,
        })),
        errorKind: null,
        runtimeMs: 12,
      })),
  );
  const executor: CodeExecutor = {
    mode: 'dev',
    supportedLanguages: ['javascript'],
    run,
  };
  const jobs: string[] = [];
  const enqueuer = {
    enqueue: jest.fn(async (id: string) => {
      if (opts.queued === false) return false;
      jobs.push(id);
      return true;
    }),
  };
  const service = new SubmissionsService(
    db.prisma,
    access,
    progress,
    executor,
    enqueuer,
    { waitMs: 300, pollMs: 5, staleMs: 60_000 },
  );
  return { service, db, run, recordCompletion, enqueuer, jobs };
}

describe('SubmissionsService', () => {
  it('creates a PENDING row, enqueues it and answers PENDING when the worker is slow', async () => {
    const { service, db, jobs } = setup();
    const view = await service.submit('u1', 'ex1', 'code', 'key-00000001');
    expect(view).toMatchObject({ submissionId: 'sub1', status: 'PENDING' });
    expect(view.results).toBeUndefined();
    expect(jobs).toEqual(['sub1']);
    expect(db.rows[0]).toMatchObject({
      status: 'PENDING',
      idempotencyKey: 'u1:key-00000001',
      scored: true,
    });
  });

  it('processor: RUNNING → COMPLETE, rewards a pass via recordCompletion and returns the full result', async () => {
    const { service, db, recordCompletion, jobs } = setup();
    const pending = service.submit('u1', 'ex1', 'code');
    await new Promise((r) => setTimeout(r, 20));
    await service.process(jobs[0]);
    const view = await pending;
    expect(view.status).toBe('COMPLETE');
    expect(view).toMatchObject({
      verdict: 'PASS',
      passed: true,
      scorePct: 100,
    });
    expect(view.hiddenRevealed).toEqual([
      { id: 'h-secret', name: 'secret negatives' },
    ]);
    expect(view.reward).toEqual({ xp: 25, coins: 12 });
    expect(recordCompletion).toHaveBeenCalledWith({
      userId: 'u1',
      lessonId: 'lesson1',
      xpSource: 'EXERCISE_PASS',
      coinSource: 'EXERCISE_PASS',
      refType: 'exercise',
      refId: 'ex1',
      questEvent: 'exercise_pass',
    });
    expect(db.rows[0].status).toBe('COMPLETE');
  });

  it('process() is claim-once: a second delivery does nothing', async () => {
    const { service, jobs, run, recordCompletion } = setup();
    void service.submit('u1', 'ex1', 'code');
    await new Promise((r) => setTimeout(r, 10));
    await Promise.all([service.process(jobs[0]), service.process(jobs[0])]);
    await service.process(jobs[0]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(recordCompletion).toHaveBeenCalledTimes(1);
  });

  it('a replay with the same Idempotency-Key returns the same submission without a new row', async () => {
    const { service, db, jobs } = setup();
    const first = service.submit('u1', 'ex1', 'code', 'retry-key-1');
    await new Promise((r) => setTimeout(r, 10));
    await service.process(jobs[0]);
    const a = await first;
    const b = await service.submit('u1', 'ex1', 'code', 'retry-key-1');
    expect(b.submissionId).toBe(a.submissionId);
    expect(b.status).toBe('COMPLETE');
    expect(db.rows).toHaveLength(1);
  });

  it('rejects a reused Idempotency-Key with a different payload (422)', async () => {
    const { service } = setup({ queued: false });
    await service.submit('u1', 'ex1', 'code', 'retry-key-2');
    await expect(
      service.submit('u1', 'ex1', 'other code', 'retry-key-2'),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('scopes idempotency keys per user', async () => {
    const { service, db } = setup({ queued: false });
    await service.submit('u1', 'ex1', 'code', 'shared-key-1');
    await service.submit('u2', 'ex1', 'code', 'shared-key-1');
    expect(db.rows.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });

  it('falls back to inline execution when the queue is unreachable (dev)', async () => {
    const { service, run } = setup({ queued: false });
    const view = await service.submit('u1', 'ex1', 'code');
    expect(run).toHaveBeenCalledTimes(1);
    expect(view.status).toBe('COMPLETE');
  });

  it('never returns hidden tests’ args/expected/actual/errors on a failed submission', async () => {
    const { service, recordCompletion } = setup({
      queued: false,
      run: async (req) => ({
        results: req.tests.map((t) =>
          t.id === 'v1'
            ? { id: t.id, name: t.name, passed: false, actual: 2, expected: 3 }
            : {
                id: t.id,
                name: t.name,
                passed: false,
                actual: -42,
                expected: -38,
                error: 'saw args -40,2',
              },
        ),
        errorKind: null,
        runtimeMs: 5,
      }),
    });
    const view = await service.submit('u1', 'ex1', 'code');
    expect(view.passed).toBe(false);
    expect(view.results?.[0]).toMatchObject({
      id: 'v1',
      actual: 2,
      expected: 3,
    });
    expect(view.results?.[1]).toEqual({
      id: 'hidden-1',
      name: 'Hidden test 1',
      passed: false,
      hidden: true,
      error: HIDDEN_TEST_FAILED_MESSAGE,
    });
    expect(view.hiddenRevealed).toEqual([]);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/-38|-42|-40|secret|h-secret/);
    expect(recordCompletion).not.toHaveBeenCalled();
    // GET returns the same redacted view.
    expect(await service.get('u1', view.submissionId)).toEqual(view);
  });

  it('hides runtime stderr on submit (it may echo hidden args)', async () => {
    const { service } = setup({
      queued: false,
      run: async (req) => ({
        results: req.tests.map((t) => ({
          id: t.id,
          name: t.name,
          passed: false,
        })),
        errorKind: 'runtime',
        runtimeMs: 5,
        output: 'Error: args were [-40,2]',
      }),
    });
    const view = await service.submit('u1', 'ex1', 'code');
    expect(view.verdict).toBe('RUNTIME');
    expect(view.message).toBe(RUNTIME_ERROR_MESSAGE);
    expect(JSON.stringify(view)).not.toContain('-40');
  });

  it('marks infra failures as ERROR with a retry message', async () => {
    const { service } = setup({
      queued: false,
      run: async () => {
        throw new ExecutorUnavailableError('Judge0 HTTP 500');
      },
    });
    const view = await service.submit('u1', 'ex1', 'code');
    expect(view).toMatchObject({
      status: 'COMPLETE',
      verdict: 'ERROR',
      message: RUNNER_UNAVAILABLE_MESSAGE,
    });
  });

  it('does not attach a reward when the lesson was already completed', async () => {
    const { service } = setup({ queued: false, alreadyCompleted: true });
    const view = await service.submit('u1', 'ex1', 'code');
    expect(view.passed).toBe(true);
    expect(view.reward).toBeUndefined();
  });

  it('enforces the 3 s per-exercise cooldown with Retry-After seconds', async () => {
    const { service } = setup({ queued: false });
    await service.submit('u1', 'ex1', 'code');
    const err = await service
      .submit('u1', 'ex1', 'code')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedException);
    expect((err as RateLimitedException).retryAfterSec).toBeGreaterThanOrEqual(
      1,
    );
    expect((err as RateLimitedException).getStatus()).toBe(429);
  });

  it('enforces 200 submissions per day', async () => {
    const { service, db } = setup({ queued: false });
    const old = Date.now() - 60_000;
    for (let i = 0; i < 200; i++) {
      db.rows.push({
        id: `old${i}`,
        userId: 'u1',
        exerciseId: `other${i}`,
        scored: true,
        status: 'COMPLETE',
        createdAt: new Date(old - i * 1000),
      } as unknown as Submission);
    }
    await expect(service.submit('u1', 'ex1', 'code')).rejects.toMatchObject({
      retryAfterSec: expect.any(Number),
    });
  });

  it('rejects malformed idempotency keys', async () => {
    const { service } = setup();
    await expect(
      service.submit('u1', 'ex1', 'code', 'bad key with spaces'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('sweeper marks stale PENDING/RUNNING rows WORKER_LOST', async () => {
    const { service, db } = setup();
    db.rows.push(
      {
        id: 'stale',
        userId: 'u1',
        exerciseId: 'ex1',
        status: 'RUNNING',
        createdAt: new Date(Date.now() - 120_000),
        output: null,
      } as unknown as Submission,
      {
        id: 'fresh',
        userId: 'u1',
        exerciseId: 'ex1',
        status: 'PENDING',
        createdAt: new Date(),
        output: null,
      } as unknown as Submission,
    );
    expect(await service.sweepStale()).toBe(1);
    const lost = await service.get('u1', 'stale');
    expect(lost).toMatchObject({
      status: 'WORKER_LOST',
      verdict: 'ERROR',
      message: RUNNER_UNAVAILABLE_MESSAGE,
    });
    expect((await service.get('u1', 'fresh')).status).toBe('PENDING');
  });

  it('404s other users’ submissions', async () => {
    const { service } = setup({ queued: false });
    const view = await service.submit('u1', 'ex1', 'code');
    await expect(service.get('u2', view.submissionId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
