import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QuizzesService } from './quizzes.service.js';
import type { ApiUser } from '../auth/auth.types.js';

const actor: ApiUser = {
  userId: 'u1',
  clerkId: 'dev-student',
  email: 's@codify.local',
  role: 'STUDENT',
  displayName: 'S',
};

const quiz = (id: string, correct: string[]) => ({
  type: 'quiz',
  attrs: {
    id,
    question: `Q ${id}?`,
    kind: correct.length > 1 ? 'multiple' : 'single',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ],
    correctOptionIds: correct,
    explanation: `because ${id}`,
  },
});

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

function docWith(...nodes: unknown[]) {
  return { type: 'doc', version: 1, content: nodes };
}

function setup(
  opts: {
    contentJson?: unknown;
    status?: 'PUBLISHED' | 'DRAFT';
    granted?: boolean;
    recentMsAgo?: number | null;
    /** Idempotency records already stored, key → attempt id. */
    seenKeys?: Record<string, string>;
    /** Stored attempts by id, for replays. */
    attempts?: Record<string, { userId: string; answersJson: unknown }>;
  } = {},
) {
  const keys = new Map(Object.entries(opts.seenKeys ?? {}));
  const prisma = {
    // The transaction client is the mock itself.
    $transaction: jest.fn(
      async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    ),
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        keys.has(where.key) ? { responseHash: keys.get(where.key) } : null,
      ),
      create: jest.fn(
        async ({ data }: { data: { key: string; responseHash: string } }) => {
          keys.set(data.key, data.responseHash);
          return data;
        },
      ),
    },
    lesson: {
      findFirst: jest.fn(async () => ({
        contentJson:
          opts.contentJson ??
          docWith(quiz('q1', ['a']), quiz('q2', ['b', 'c'])),
        module: {
          course: { status: opts.status ?? 'PUBLISHED', deletedAt: null },
        },
      })),
    },
    quizAttempt: {
      findFirst: jest.fn(async () =>
        opts.recentMsAgo == null
          ? null
          : { createdAt: new Date(Date.now() - opts.recentMsAgo) },
      ),
      create: jest.fn(async () => ({ id: 'att-1' })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          opts.attempts?.[where.id] ?? null,
      ),
    },
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({
      access:
        opts.granted === false
          ? { granted: false, reason: 'paywall', requiredPlans: [{ id: 'p' }] }
          : { granted: true, reason: 'subscription' },
      courseId: 'c1',
    })),
  };
  const progress = {
    recordCompletion: jest.fn(async () => ({
      alreadyCompleted: false,
      progress: {
        lessonId: 'l1',
        completedAt: new Date().toISOString(),
        xpAwarded: 10,
        coinsAwarded: 5,
      },
      totals: { totalXp: 10, coins: 5 },
    })),
  };
  const svc = new QuizzesService(
    prisma as never,
    access as never,
    progress as never,
  );
  return { svc, prisma, access, progress };
}

describe('QuizzesService.submit', () => {
  it('a perfect attempt passes, reveals the key, and completes with QUIZ_PERFECT', async () => {
    const { svc, prisma, progress } = setup();
    const res = await svc.submit(actor, 'l1', {
      answers: { q1: ['a'], q2: ['c', 'b'] },
    });
    expect(res).toMatchObject({
      scorePct: 100,
      passed: true,
      correctCount: 2,
      totalCount: 2,
    });
    expect(res.perQuestion[0]).toEqual({
      id: 'q1',
      correct: true,
      correctOptionIds: ['a'],
      explanation: 'because q1',
    });
    expect(prisma.quizAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scorePct: 100, passed: true }),
      }),
    );
    expect(progress.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        lessonId: 'l1',
        xpSource: 'QUIZ_PERFECT',
        coinSource: 'QUIZ_PERFECT',
        refType: 'quiz',
        refId: 'att-1',
        questEvent: 'quiz_pass',
      }),
    );
    expect(res.completion?.alreadyCompleted).toBe(false);
  });

  it('a failed attempt hides the answer key and does not complete the lesson', async () => {
    const { svc, progress } = setup();
    const res = await svc.submit(actor, 'l1', {
      answers: { q1: ['b'], q2: ['b'] },
    });
    expect(res.passed).toBe(false);
    expect(res.scorePct).toBe(0);
    for (const q of res.perQuestion) {
      expect(q).toEqual({ id: q.id, correct: false });
    }
    expect(progress.recordCompletion).not.toHaveBeenCalled();
    expect(res.completion).toBeUndefined();
  });

  it('a non-perfect pass completes with the plain lesson source', async () => {
    const qs = ['q1', 'q2', 'q3', 'q4'].map((id) => quiz(id, ['a']));
    const { svc, progress } = setup({ contentJson: docWith(...qs) });
    const res = await svc.submit(actor, 'l1', {
      answers: { q1: ['a'], q2: ['a'], q3: ['a'], q4: ['b'] },
    });
    expect(res).toMatchObject({ scorePct: 75, passed: true });
    expect(progress.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        xpSource: 'LESSON_COMPLETE',
        coinSource: 'LESSON_COMPLETE',
      }),
    );
  });

  it('ignores answers for unknown quizzes and options', async () => {
    const { svc, prisma } = setup();
    await svc.submit(actor, 'l1', {
      answers: {
        q1: ['a', 'zzz'],
        nope: ['a'],
        q2: 'b' as unknown as string[],
      },
    });
    const stored = (
      prisma.quizAttempt.create.mock.calls[0] as unknown as [
        { data: { answersJson: Record<string, string[]> } },
      ]
    )[0].data.answersJson;
    expect(Object.keys(stored).sort()).toEqual(['q1', 'q2']);
    expect(stored['q1']).toEqual(['a']);
  });

  it('enforces the per-lesson cooldown with 429', async () => {
    const { svc, prisma } = setup({ recentMsAgo: 500 });
    await expect(
      svc.submit(actor, 'l1', { answers: {} }),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
  });

  it('paywalls a lesson the student cannot access (402)', async () => {
    const { svc } = setup({ granted: false });
    const err = await svc.submit(actor, 'l1', { answers: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
  });

  it('404s an unpublished lesson and 400s a lesson without quiz blocks', async () => {
    await expect(
      setup({ status: 'DRAFT' }).svc.submit(actor, 'l1', { answers: {} }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({
        contentJson: docWith({
          type: 'paragraph',
          content: [{ type: 'text', text: 'hi' }],
        }),
      }).svc.submit(actor, 'l1', { answers: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a clientTimestamp in the future', async () => {
    const { svc } = setup();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(
      svc.submit(actor, 'l1', { answers: {}, clientTimestamp: future }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('QuizzesService.submit with an Idempotency-Key', () => {
  const recordKey = 'quiz_attempt:u1:l1:evt-12345678';

  it('stores the key with the new attempt', async () => {
    const { svc, prisma } = setup();
    const res = await svc.submit(
      actor,
      'l1',
      { answers: { q1: ['a'], q2: ['b', 'c'] } },
      'evt-12345678',
    );
    expect(res.attemptId).toBe('att-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith({
      data: {
        key: recordKey,
        scope: 'quiz_attempt',
        userId: 'u1',
        responseHash: 'att-1',
      },
    });
  });

  it('a replayed key returns the original attempt, skips the cooldown and records nothing new', async () => {
    const { svc, prisma, progress } = setup({
      recentMsAgo: 100,
      seenKeys: { [recordKey]: 'att-orig' },
      attempts: {
        'att-orig': { userId: 'u1', answersJson: { q1: ['a'], q2: ['b'] } },
      },
    });
    // The replay body differs on purpose: the stored answers win.
    const res = await svc.submit(
      actor,
      'l1',
      { answers: { q1: ['a'], q2: ['b', 'c'] } },
      'evt-12345678',
    );
    expect(res).toMatchObject({
      attemptId: 'att-orig',
      scorePct: 50,
      passed: false,
    });
    expect(prisma.quizAttempt.findFirst).not.toHaveBeenCalled();
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
    expect(progress.recordCompletion).not.toHaveBeenCalled();
  });

  it('a replay of a passing attempt re-runs the idempotent completion with the original ref', async () => {
    const { svc, progress } = setup({
      seenKeys: { [recordKey]: 'att-orig' },
      attempts: {
        'att-orig': {
          userId: 'u1',
          answersJson: { q1: ['a'], q2: ['b', 'c'] },
        },
      },
    });
    const res = await svc.submit(actor, 'l1', { answers: {} }, 'evt-12345678');
    expect(res.passed).toBe(true);
    expect(progress.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ refType: 'quiz', refId: 'att-orig' }),
    );
  });

  it("a key pointing at another user's attempt 404s", async () => {
    const { svc } = setup({
      seenKeys: { [recordKey]: 'att-x' },
      attempts: { 'att-x': { userId: 'someone-else', answersJson: {} } },
    });
    await expect(
      svc.submit(actor, 'l1', { answers: {} }, 'evt-12345678'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('losing a concurrent race on the key replays the winner', async () => {
    const { svc, prisma } = setup({
      attempts: {
        'att-winner': {
          userId: 'u1',
          answersJson: { q1: ['a'], q2: ['b', 'c'] },
        },
      },
    });
    // First lookup misses; the insert then hits the unique index because
    // the other request committed in between.
    prisma.$transaction.mockImplementationOnce(async () => {
      await prisma.idempotencyRecord.create({
        data: { key: recordKey, responseHash: 'att-winner' },
      });
      throw uniqueViolation();
    });
    const res = await svc.submit(
      actor,
      'l1',
      { answers: { q1: ['a'], q2: ['b', 'c'] } },
      'evt-12345678',
    );
    expect(res.attemptId).toBe('att-winner');
  });

  it('without a key, a unique violation from the insert propagates', async () => {
    const { svc, prisma } = setup();
    prisma.$transaction.mockImplementationOnce(async () => {
      throw uniqueViolation();
    });
    await expect(svc.submit(actor, 'l1', { answers: {} })).rejects.toThrow(
      'unique',
    );
  });
});
