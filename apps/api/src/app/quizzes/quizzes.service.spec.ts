import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
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

function docWith(...nodes: unknown[]) {
  return { type: 'doc', version: 1, content: nodes };
}

function setup(
  opts: {
    contentJson?: unknown;
    status?: 'PUBLISHED' | 'DRAFT';
    granted?: boolean;
    recentMsAgo?: number | null;
  } = {},
) {
  const prisma = {
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
