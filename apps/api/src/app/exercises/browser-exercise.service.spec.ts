import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProgressService } from '../progress/progress.service.js';
import { BrowserExerciseService } from './browser-exercise.service.js';

const tests = [
  { id: 't1', name: 'has a heading', args: ['text', 'h1'], expected: 'Hi' },
  {
    id: 't2',
    name: 'red',
    args: ['style', 'h1', 'color'],
    expected: 'rgb(255, 0, 0)',
  },
];

function setup(
  opts: {
    language?: string;
    granted?: boolean;
    recent?: number;
    seen?: unknown;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    exercise: {
      findUnique: jest.fn(async () => ({
        id: 'ex1',
        language: opts.language ?? 'web',
        visibleTestsJson: tests,
        lesson: { id: 'l1' },
      })),
    },
    submission: {
      findUnique: jest.fn(async () => opts.seen ?? null),
      count: jest.fn(async () => opts.recent ?? 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          id: 'sub1',
          createdAt: new Date(),
          runtimeMs: null,
          memoryKb: null,
          ...data,
          completedAt: data['completedAt'] as Date,
        };
      }),
    },
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({
      access: { granted: opts.granted ?? true },
    })),
  } as unknown as AccessService;
  const recordCompletion = jest.fn(async () => ({
    alreadyCompleted: false,
    reward: { xp: 20, coins: 5 },
  }));
  const svc = new BrowserExerciseService(
    prisma as unknown as PrismaService,
    access,
    { recordCompletion } as unknown as ProgressService,
  );
  return { svc, prisma, recordCompletion, created };
}

const pass = [
  { id: 't1', passed: true },
  { id: 't2', passed: true },
];

describe('BrowserExerciseService', () => {
  it('records a passing run and completes the lesson once', async () => {
    const { svc, recordCompletion, created } = setup();
    const view = await svc.record(
      'u1',
      'ex1',
      { code: '<h1>Hi</h1>', results: pass },
      'key-123456',
    );
    expect(view).toMatchObject({
      status: 'COMPLETE',
      verdict: 'PASS',
      passed: true,
      scorePct: 100,
    });
    expect(view.reward).toEqual({ xp: 20, coins: 5 });
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: 'l1',
        xpSource: 'EXERCISE_PASS',
        questEvent: 'exercise_pass',
      }),
    );
    expect(created[0]).toMatchObject({
      idempotencyKey: 'u1:browser:key-123456',
      scored: true,
    });
  });

  it('a failing run is stored as FAIL without a completion', async () => {
    const { svc, recordCompletion } = setup();
    const view = await svc.record('u1', 'ex1', {
      code: 'x',
      results: [
        { id: 't1', passed: true },
        { id: 't2', passed: false, error: 'nope' },
      ],
    });
    expect(view.verdict).toBe('FAIL');
    expect(view.scorePct).toBe(50);
    expect(recordCompletion).not.toHaveBeenCalled();
  });

  it('requires every test exactly once', async () => {
    const { svc } = setup();
    await expect(
      svc.record('u1', 'ex1', {
        code: 'x',
        results: [{ id: 't1', passed: true }],
      }),
    ).rejects.toMatchObject({ response: { code: 'BROWSER_RESULTS_MISMATCH' } });
    await expect(
      svc.record('u1', 'ex1', {
        code: 'x',
        results: [
          { id: 't1', passed: true },
          { id: 't1', passed: true },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'BROWSER_RESULTS_MISMATCH' } });
  });

  it('refuses runner-graded exercises, missing access and floods', async () => {
    await expect(
      setup({ language: 'javascript' }).svc.record('u1', 'ex1', {
        code: 'x',
        results: pass,
      }),
    ).rejects.toMatchObject({ response: { code: 'NOT_A_BROWSER_EXERCISE' } });
    await expect(
      setup({ granted: false }).svc.record('u1', 'ex1', {
        code: 'x',
        results: pass,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      setup({ recent: 10 }).svc.record('u1', 'ex1', {
        code: 'x',
        results: pass,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('a replayed Idempotency-Key returns the stored submission', async () => {
    const seen = {
      id: 'sub0',
      userId: 'u1',
      exerciseId: 'ex1',
      status: 'COMPLETE',
      verdict: 'PASS',
      scorePct: 100,
      runtimeMs: null,
      memoryKb: null,
      output: null,
      resultJson: null,
      createdAt: new Date(),
      completedAt: new Date(),
    };
    const { svc, prisma } = setup({ seen });
    const view = await svc.record(
      'u1',
      'ex1',
      { code: 'x', results: pass },
      'key-123456',
    );
    expect(view.submissionId).toBe('sub0');
    expect(prisma.submission.create).not.toHaveBeenCalled();
  });
});
