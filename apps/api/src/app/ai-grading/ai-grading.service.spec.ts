import type { AiPrompt, LessonType } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProgressService } from '../progress/progress.service.js';
import { RateLimitedException } from '../exercises/rate-limit.js';
import {
  AiGradingService,
  normalizeResponseForCache,
  rubricHash,
} from './ai-grading.service.js';
import type { AiGrader, JudgeOutcome } from './ai-grading.provider.js';

const teacher: ApiUser = {
  userId: 't1',
  clerkId: 'c',
  email: 't@x',
  role: 'TEACHER',
  displayName: 'T',
};

const PROMPT: AiPrompt = {
  id: 'p1',
  promptText: 'Explain errors',
  contextText: null,
  rubricJson: [
    {
      id: 'kw',
      label: 'mentions try',
      weight: 1,
      kind: 'keyword',
      config: { all: ['try'] },
    },
    {
      id: 'llm',
      label: 'explains why',
      weight: 1,
      kind: 'llm',
      config: { concepts: ['crash'] },
    },
  ],
  passThreshold: 100,
  maxAttempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(
  opts: {
    lessonType?: LessonType;
    judge?: JudgeOutcome;
    recent?: Date[];
    last?: Date | null;
    cacheHit?: boolean;
    alreadyCompleted?: boolean;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const cacheWrites: unknown[] = [];
  const prisma = {
    aiPrompt: {
      findUnique: jest.fn(async () => ({
        ...PROMPT,
        lesson: { id: 'l1', type: opts.lessonType ?? 'AI_PROMPT' },
      })),
      create: jest.fn(async ({ data }: { data: object }) => ({
        ...PROMPT,
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: object }) => ({
        ...PROMPT,
        ...data,
      })),
    },
    aiSubmission: {
      findFirst: jest.fn(async ({ where }: { where: { passed?: boolean } }) => {
        if (where.passed) return null;
        return opts.last ? { createdAt: opts.last } : null;
      }),
      findMany: jest.fn(async () =>
        (opts.recent ?? []).map((createdAt) => ({ createdAt })),
      ),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `s${created.length}`, ...data };
      }),
    },
    aiGradeCache: {
      findUnique: jest.fn(async () =>
        opts.cacheHit
          ? {
              scorePct: 100,
              passed: true,
              breakdownJson: [
                { id: 'kw', label: 'mentions try', weight: 1, passed: true },
              ],
              gradedBy: 'LLM',
            }
          : null,
      ),
      createMany: jest.fn(async (args: unknown) => {
        cacheWrites.push(args);
        return { count: 1 };
      }),
    },
    lesson: {
      findFirst: jest.fn(async () => ({
        id: 'l1',
        type: opts.lessonType ?? 'READING',
        aiPromptId: null,
        module: { course: { authorId: 't1' } },
      })),
    },
  };
  Object.assign(prisma, {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  });
  // `lesson.update` inside the transaction:
  (prisma.lesson as Record<string, unknown>)['update'] = jest.fn(
    async ({ data }: { data: object }) => data,
  );
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  const recordCompletion = jest.fn(async () => ({
    alreadyCompleted: opts.alreadyCompleted ?? false,
    reward: { xp: 30 },
    progress: {},
    totals: {},
  }));
  const judge = jest.fn(
    async (): Promise<JudgeOutcome> =>
      opts.judge ?? {
        results: [
          { id: 'llm', label: 'explains why', weight: 1, passed: true },
        ],
        gradedBy: 'LLM',
        fallback: false,
      },
  );
  const grader: AiGrader = { mode: 'llm', judge };
  const service = new AiGradingService(
    prisma as unknown as PrismaService,
    access,
    { recordCompletion } as unknown as ProgressService,
    grader,
  );
  return { service, prisma, created, cacheWrites, judge, recordCompletion };
}

describe('AiGradingService.submit', () => {
  it('grades, writes the cross-user cache and completes the lesson via recordCompletion', async () => {
    const { service, created, cacheWrites, recordCompletion } = setup();
    const res = await service.submit(
      'u1',
      'p1',
      'Always try/catch so the app does not crash',
    );
    expect(res).toMatchObject({
      passed: true,
      scorePct: 100,
      gradedBy: 'LLM',
      cached: false,
      reward: { xp: 30 },
    });
    expect(created[0]).toMatchObject({
      userId: 'u1',
      aiPromptId: 'p1',
      cached: false,
      gradedBy: 'LLM',
    });
    expect(cacheWrites).toHaveLength(1);
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        xpSource: 'AI_PROMPT_PASS',
        coinSource: 'AI_PROMPT_PASS',
        refType: 'ai_prompt',
        questEvent: 'ai_prompt_pass',
        lessonId: 'l1',
        refId: 'p1',
      }),
    );
  });

  it('a cache hit skips the grader but still records the user’s own row with cached: true', async () => {
    const { service, created, judge, cacheWrites } = setup({ cacheHit: true });
    const res = await service.submit('u2', 'p1', 'whatever');
    expect(judge).not.toHaveBeenCalled();
    expect(res.cached).toBe(true);
    expect(created[0]).toMatchObject({
      userId: 'u2',
      cached: true,
      passed: true,
    });
    expect(cacheWrites).toHaveLength(0);
  });

  it('never caches a heuristic fallback grade', async () => {
    const { service, cacheWrites } = setup({
      judge: {
        results: [{ id: 'llm', label: 'x', weight: 1, passed: false }],
        gradedBy: 'HEURISTIC',
        fallback: true,
      },
    });
    const res = await service.submit('u1', 'p1', 'try');
    expect(res.gradedBy).toBe('HEURISTIC');
    expect(cacheWrites).toHaveLength(0);
  });

  it('CAPSTONE lessons complete with refType capstone / capstone_pass', async () => {
    const { service, recordCompletion } = setup({ lessonType: 'CAPSTONE' });
    await service.submit('u1', 'p1', 'try it so nothing will crash');
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        refType: 'capstone',
        questEvent: 'capstone_pass',
      }),
    );
  });

  it('no reward payload when the lesson was already complete', async () => {
    const { service } = setup({ alreadyCompleted: true });
    const res = await service.submit('u1', 'p1', 'try crash');
    expect(res.passed).toBe(true);
    expect(res.reward).toBeUndefined();
  });

  it('429s within the 3 s per-prompt cooldown', async () => {
    const { service } = setup({ last: new Date(Date.now() - 1000) });
    const err = (await service
      .submit('u1', 'p1', 'x')
      .catch((e: unknown) => e)) as RateLimitedException;
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'AI_SUBMIT_COOLDOWN' });
    expect(err.retryAfterSec).toBe(2);
  });

  it('429s at 5 per minute across prompts, with Retry-After until the oldest leaves the window', async () => {
    const now = Date.now();
    const recent = [5, 10, 20, 30, 50].map((s) => new Date(now - s * 1000));
    const { service } = setup({ recent });
    const err = (await service
      .submit('u1', 'p1', 'x')
      .catch((e: unknown) => e)) as RateLimitedException;
    expect(err).toBeInstanceOf(RateLimitedException);
    expect(err.getResponse()).toMatchObject({ code: 'AI_RATE_LIMIT_MINUTE' });
    expect(err.retryAfterSec).toBeGreaterThanOrEqual(9);
    expect(err.retryAfterSec).toBeLessThanOrEqual(11);
  });

  it('429s at 60 per day', async () => {
    const now = Date.now();
    const recent = Array.from(
      { length: 60 },
      (_, i) => new Date(now - 120_000 - i * 60_000),
    );
    const { service } = setup({ recent });
    const err = (await service
      .submit('u1', 'p1', 'x')
      .catch((e: unknown) => e)) as RateLimitedException;
    expect(err.getResponse()).toMatchObject({ code: 'AI_RATE_LIMIT_DAY' });
    expect(err.retryAfterSec).toBeGreaterThan(3600);
  });
});

describe('AiGradingService admin', () => {
  it('rejects invalid rubrics with 400 at save time', async () => {
    const { service } = setup();
    await expect(
      service.createForLesson(teacher, 'l1', {
        promptText: 'x',
        rubric: [
          { id: 'a', label: 'a', weight: 1, kind: 'keyword', config: {} },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.createForLesson(teacher, 'l1', {
        promptText: 'x',
        rubric: [],
        passThreshold: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps a CAPSTONE lesson’s type when attaching a prompt; flips others to AI_PROMPT', async () => {
    const capstone = setup({ lessonType: 'CAPSTONE' });
    await capstone.service.createForLesson(teacher, 'l1', {
      promptText: 'x',
      rubric: PROMPT.rubricJson as never,
    });
    expect(
      (capstone.prisma.lesson as unknown as { update: jest.Mock }).update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'CAPSTONE' }),
      }),
    );
    const reading = setup({ lessonType: 'READING' });
    await reading.service.createForLesson(teacher, 'l1', {
      promptText: 'x',
      rubric: PROMPT.rubricJson as never,
    });
    expect(
      (reading.prisma.lesson as unknown as { update: jest.Mock }).update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'AI_PROMPT' }),
      }),
    );
  });

  it('forbids a TEACHER from another teacher’s course (incl. reading the rubric config)', async () => {
    const { service } = setup();
    const other: ApiUser = { ...teacher, userId: 'someone-else' };
    await expect(
      service.createForLesson(other, 'l1', {
        promptText: 'x',
        rubric: PROMPT.rubricJson as never,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.getAdmin(other, 'p1')).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.preview(other, 'p1', 'x')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.getAdmin({ ...other, role: 'ADMIN' }, 'p1'),
    ).resolves.toMatchObject({ id: 'p1' });
  });
});

describe('cache keys', () => {
  it('normalises only presentation-neutral differences', () => {
    expect(normalizeResponseForCache('  hello  \r\nworld\t\n')).toBe(
      'hello\nworld',
    );
    expect(normalizeResponseForCache('Hello')).not.toBe(
      normalizeResponseForCache('hello'),
    );
    expect(normalizeResponseForCache('é')).toBe(normalizeResponseForCache('é'));
  });
  it('rubric hash changes with rubric, threshold and prompt text', () => {
    const base = rubricHash(PROMPT);
    expect(rubricHash({ ...PROMPT, passThreshold: 50 })).not.toBe(base);
    expect(rubricHash({ ...PROMPT, promptText: 'other' })).not.toBe(base);
    expect(rubricHash({ ...PROMPT, rubricJson: [] })).not.toBe(base);
    expect(rubricHash({ ...PROMPT })).toBe(base);
  });
});
