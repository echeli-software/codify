import { Prisma, type LessonType } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { GamificationService } from '../gamification/gamification.service.js';
import type { QuestsService } from '../gamification/quests.service.js';
import type { BadgesService } from '../gamification/badges.service.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import type { GrantRewardParams } from '../gamification/gamification.types.js';
import {
  containsQuizBlock,
  ProgressService,
  validateClientTimestamp,
} from './progress.service.js';

const student: ApiUser = {
  userId: 'u1',
  clerkId: 'c',
  email: 's@x',
  role: 'STUDENT',
  displayName: 'S',
};

function setup(
  type: LessonType,
  contentJson: unknown = { type: 'doc', content: [] },
) {
  const prisma = {
    lesson: {
      findFirst: jest.fn(async () => ({ id: 'l1', type, contentJson })),
    },
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  const service = new ProgressService(
    prisma as unknown as PrismaService,
    access,
    {} as GamificationService,
    {} as QuestsService,
    {} as BadgesService,
    {} as GamificationConfigService,
  );
  const recordCompletion = jest
    .spyOn(service, 'recordCompletion')
    .mockResolvedValue({
      alreadyCompleted: false,
      progress: {
        lessonId: 'l1',
        completedAt: new Date().toISOString(),
        xpAwarded: 10,
        coinsAwarded: 5,
      },
      totals: { totalXp: 10, coins: 5 },
    });
  return { service, recordCompletion };
}

describe('ProgressService.complete — lesson type guard', () => {
  it.each(['EXERCISE', 'AI_PROMPT', 'SCENARIO', 'CAPSTONE'] as LessonType[])(
    'rejects %s lessons with 409 LESSON_COMPLETES_VIA_OWN_FLOW',
    async (type) => {
      const { service, recordCompletion } = setup(type);
      const err = (await service
        .complete(student, 'l1')
        .catch((e: unknown) => e)) as {
        getStatus(): number;
        getResponse(): unknown;
      };
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({
        code: 'LESSON_COMPLETES_VIA_OWN_FLOW',
        lessonType: type,
      });
      expect(recordCompletion).not.toHaveBeenCalled();
    },
  );

  it('rejects QUIZ lessons that contain quiz blocks (graded elsewhere)', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'callout', content: [{ type: 'quiz', attrs: { id: 'q1' } }] },
      ],
    };
    const { service } = setup('QUIZ', doc);
    await expect(service.complete(student, 'l1')).rejects.toMatchObject({
      response: { code: 'QUIZ_REQUIRES_GRADING' },
    });
  });

  it('lets a QUIZ lesson without quiz blocks and READING lessons complete directly', async () => {
    for (const type of ['QUIZ', 'READING'] as LessonType[]) {
      const { service, recordCompletion } = setup(type);
      await expect(service.complete(student, 'l1')).resolves.toMatchObject({
        progress: { lessonId: 'l1' },
      });
      expect(recordCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          xpSource: 'LESSON_COMPLETE',
          refType: 'lesson',
          clientTimestamp: null,
        }),
      );
    }
  });

  it('passes a valid clientTimestamp through to recordCompletion', async () => {
    const { service, recordCompletion } = setup('READING');
    const ts = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await service.complete(student, 'l1', { clientTimestamp: ts });
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ clientTimestamp: ts }),
    );
  });

  it('409 with code LESSON_ALREADY_COMPLETED on replay', async () => {
    const { service, recordCompletion } = setup('READING');
    recordCompletion.mockResolvedValueOnce({
      alreadyCompleted: true,
      progress: {
        lessonId: 'l1',
        completedAt: new Date().toISOString(),
        xpAwarded: 10,
        coinsAwarded: 5,
      },
      totals: { totalXp: 10, coins: 5 },
    });
    await expect(service.complete(student, 'l1')).rejects.toMatchObject({
      response: { code: 'LESSON_ALREADY_COMPLETED' },
    });
  });
});

describe('validateClientTimestamp (docs/16 §8: clamp, not reject)', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  it('keeps times within the last 24 h', () => {
    const warn = jest.fn();
    expect(validateClientTimestamp('2026-10-07T11:00:00Z', now, warn)).toBe(
      '2026-10-07T11:00:00.000Z',
    );
    expect(validateClientTimestamp('2026-10-06T12:30:00Z', now, warn)).toBe(
      '2026-10-06T12:30:00.000Z',
    );
    expect(validateClientTimestamp(undefined, now, warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
  it('clamps any future time to now and warns', () => {
    const warn = jest.fn();
    expect(validateClientTimestamp('2026-10-07T12:00:01Z', now, warn)).toBe(
      '2026-10-07T12:00:00.000Z',
    );
    expect(validateClientTimestamp('2027-01-01T00:00:00Z', now, warn)).toBe(
      '2026-10-07T12:00:00.000Z',
    );
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/future/);
  });
  it('clamps times older than 24 h to now and warns', () => {
    const warn = jest.fn();
    expect(validateClientTimestamp('2026-10-06T11:59:00Z', now, warn)).toBe(
      '2026-10-07T12:00:00.000Z',
    );
    expect(validateClientTimestamp('2026-01-01T00:00:00Z', now, warn)).toBe(
      '2026-10-07T12:00:00.000Z',
    );
    expect(warn.mock.calls[0][0]).toMatch(/older than 24 h/);
  });
  it('still rejects garbage', () => {
    expect(() => validateClientTimestamp('yesterday', now)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_CLIENT_TIMESTAMP' }),
      }),
    );
  });
});

// ─── recordCompletion: earning rules (ECO-1) ───────────────────────────────

function rewardOf(p: GrantRewardParams) {
  return {
    xp: p.baseXp,
    coins: p.baseCoins,
    multiplier: 1,
    xpMultiplier: 1,
    coinMultiplier: 1,
    breakdown: [{ source: 'base', xp: p.baseXp, coins: p.baseCoins }],
    totals: { totalXp: 100, coins: 50, level: 1 },
    levelUp: null,
    streak: {
      currentDays: 3,
      longestDays: 3,
      freezesAvailable: 0,
      extended: !!p.countsForStreak,
    },
  };
}

function recordSetup(opts: {
  type?: LessonType;
  baseXp?: number;
  baseCoins?: number;
  existing?: { completedAt: Date } | null;
  config?: Record<string, unknown>;
  branchesToday?: number;
  idempotencyDupe?: boolean;
}) {
  const grants: GrantRewardParams[] = [];
  const idemKeys: string[] = [];
  const tx = {
    progress: {
      create: jest.fn(async () => ({ id: 'p1' })),
      update: jest.fn(async ({ data }: { data: Record<string, number> }) => ({
        lessonId: 'l1',
        completedAt: new Date('2026-11-07T10:00:00Z'),
        ...data,
      })),
    },
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ totalXp: 100, coins: 50 })),
    },
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (opts.idempotencyDupe) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7',
          });
        }
        idemKeys.push(data.key);
        return data;
      }),
    },
  };
  const prisma = {
    lesson: {
      findFirst: jest.fn(async () => ({
        id: 'l1',
        type: opts.type ?? 'READING',
        baseXp: opts.baseXp ?? 10,
        baseCoins: opts.baseCoins ?? 5,
        module: { course: { id: 'c1', status: 'PUBLISHED' } },
      })),
    },
    progress: {
      findUnique: jest.fn(async () =>
        opts.existing
          ? {
              lessonId: 'l1',
              completedAt: opts.existing.completedAt,
              xpAwarded: 10,
              coinsAwarded: 5,
            }
          : null,
      ),
    },
    courseCategory: { findMany: jest.fn(async () => []) },
    user: {
      findUniqueOrThrow: jest.fn(async () => ({
        timezone: 'UTC',
        totalXp: 100,
        coins: 50,
      })),
    },
    idempotencyRecord: {
      count: jest.fn(async () => opts.branchesToday ?? 0),
    },
    gamificationConfig: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        opts.config && where.key in opts.config
          ? { key: where.key, value: opts.config[where.key] }
          : null,
      ),
      findMany: jest.fn(
        async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in
            .filter((k) => opts.config && k in opts.config)
            .map((k) => ({ key: k, value: opts.config![k] })),
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const gamification = {
    grantReward: jest.fn(async (p: GrantRewardParams) => {
      grants.push(p);
      return rewardOf(p);
    }),
    maybeStartSurpriseBoost: jest.fn(async () => null),
  };
  const quests = { onEvent: jest.fn(async () => []) };
  const badges = { evaluate: jest.fn(async () => []) };
  const service = new ProgressService(
    prisma as unknown as PrismaService,
    {} as AccessService,
    gamification as unknown as GamificationService,
    quests as unknown as QuestsService,
    badges as unknown as BadgesService,
    new GamificationConfigService(prisma as unknown as PrismaService),
  );
  return { service, grants, idemKeys, quests, badges, tx };
}

const params = {
  userId: 'u1',
  lessonId: 'l1',
  xpSource: 'LESSON_COMPLETE' as const,
  coinSource: 'LESSON_COMPLETE' as const,
  refType: 'lesson',
  refId: 'l1',
};

describe('recordCompletion — earning rules', () => {
  it('pays the per-type default when the lesson keeps the column default', async () => {
    const { service, grants } = recordSetup({ type: 'QUIZ' });
    const out = await service.recordCompletion(params);
    expect(grants[0]).toMatchObject({ baseXp: 15, baseCoins: 8 });
    expect(out.reward?.xp).toBe(15);
  });

  it('an author-set value wins, per field; admin config overrides the table', async () => {
    const a = recordSetup({ type: 'EXERCISE', baseXp: 40 });
    await a.service.recordCompletion(params);
    expect(a.grants[0]).toMatchObject({ baseXp: 40, baseCoins: 12 });
    const b = recordSetup({
      type: 'AI_PROMPT',
      config: { 'earning.byLessonType': { AI_PROMPT: { xp: 33, coins: 3 } } },
    });
    await b.service.recordCompletion(params);
    expect(b.grants[0]).toMatchObject({ baseXp: 33, baseCoins: 3 });
  });

  it('a perfect quiz adds its own QUIZ_PERFECT grant and folds it into the reward', async () => {
    const { service, grants } = recordSetup({ type: 'QUIZ' });
    const out = await service.recordCompletion({
      ...params,
      refType: 'quiz',
      refId: 'att1',
      quiz: { scorePct: 100, correctCount: 4, totalCount: 4 },
    });
    expect(grants.map((g) => g.xpSource)).toEqual([
      'LESSON_COMPLETE',
      'QUIZ_PERFECT',
    ]);
    expect(grants[1]).toMatchObject({
      baseXp: 10,
      baseCoins: 5,
      idempotencyKey: 'quiz_perfect:u1:l1',
    });
    expect(out.reward).toMatchObject({ xp: 25, coins: 13 });
    expect(out.reward?.breakdown).toContainEqual({
      source: 'QUIZ_PERFECT',
      xp: 10,
      coins: 5,
    });
    expect(out.progress.xpAwarded).toBe(25);
  });

  it('a non-perfect pass gets no perfect bonus; per-question bonus when configured', async () => {
    const plain = recordSetup({ type: 'QUIZ' });
    await plain.service.recordCompletion({
      ...params,
      quiz: { scorePct: 75, correctCount: 3, totalCount: 4 },
    });
    expect(plain.grants).toHaveLength(1);
    const perQ = recordSetup({
      type: 'QUIZ',
      config: { 'earning.quizPerQuestionBonus': { xp: 2, coins: 1 } },
    });
    const out = await perQ.service.recordCompletion({
      ...params,
      quiz: { scorePct: 75, correctCount: 3, totalCount: 4 },
    });
    expect(perQ.grants[1]).toMatchObject({
      baseXp: 6,
      baseCoins: 3,
      idempotencyKey: 'quiz_questions:u1:l1',
    });
    expect(out.reward?.xp).toBe(21);
  });
});

describe('recordCompletion — repeats (retake / scenario branch)', () => {
  const done = { completedAt: new Date('2026-01-01T00:00:00Z') };

  it('an exercise re-pass pays RETAKE once per local day, counting for streak + quests', async () => {
    const { service, grants, idemKeys, quests } = recordSetup({
      existing: done,
    });
    const out = await service.recordCompletion({
      ...params,
      xpSource: 'EXERCISE_PASS',
      coinSource: 'EXERCISE_PASS',
      refType: 'exercise',
      refId: 'ex1',
      questEvent: 'exercise_pass',
    });
    expect(out).toMatchObject({ alreadyCompleted: true, retake: true });
    expect(grants[0]).toMatchObject({
      baseXp: 5,
      baseCoins: 2,
      xpSource: 'RETAKE',
      coinSource: 'RETAKE',
      countsForStreak: true,
    });
    expect(idemKeys[0]).toMatch(/^retake:u1:l1:\d{4}-\d{2}-\d{2}$/);
    expect(quests.onEvent).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ type: 'exercise_pass', repeat: true }),
    );
  });

  it('a second re-pass the same day is a plain replay', async () => {
    const { service, grants } = recordSetup({
      existing: done,
      idempotencyDupe: true,
    });
    const out = await service.recordCompletion({
      ...params,
      xpSource: 'AI_PROMPT_PASS',
      coinSource: 'AI_PROMPT_PASS',
    });
    expect(out.alreadyCompleted).toBe(true);
    expect(out.retake).toBeUndefined();
    expect(out.reward).toBeUndefined();
    expect(grants).toHaveLength(0);
  });

  it('reading / quiz replays never pay a retake', async () => {
    const { service, grants } = recordSetup({ existing: done });
    const out = await service.recordCompletion(params);
    expect(out.reward).toBeUndefined();
    expect(grants).toHaveLength(0);
  });

  it('a new scenario ending pays SCENARIO_BRANCH, a seen one does not', async () => {
    const fresh = recordSetup({ existing: done });
    const out = await fresh.service.recordCompletion({
      ...params,
      xpSource: 'SCENARIO_COMPLETE',
      coinSource: 'SCENARIO_COMPLETE',
      scenario: { scenarioId: 's1', endingKey: 'end/x', isNewEnding: true },
    });
    expect(out.retake).toBe(true);
    expect(fresh.grants[0]).toMatchObject({
      baseXp: 10,
      baseCoins: 5,
      xpSource: 'SCENARIO_BRANCH',
      idempotencyKey: 'scenario_branch:u1:s1:end/x',
      countsForStreak: true,
    });
    const seen = recordSetup({ existing: done });
    await seen.service.recordCompletion({
      ...params,
      xpSource: 'SCENARIO_COMPLETE',
      coinSource: 'SCENARIO_COMPLETE',
      scenario: { scenarioId: 's1', endingKey: 'end/x', isNewEnding: false },
    });
    expect(seen.grants).toHaveLength(0);
  });

  it('caps scenario branch rewards at 3 per scenario per day (first completion today counts)', async () => {
    const scenario = {
      scenarioId: 's1',
      endingKey: 'end/y',
      isNewEnding: true,
    };
    const p = {
      ...params,
      xpSource: 'SCENARIO_COMPLETE' as const,
      coinSource: 'SCENARIO_COMPLETE' as const,
      scenario,
    };
    const two = recordSetup({ existing: done, branchesToday: 2 });
    await two.service.recordCompletion(p);
    expect(two.grants).toHaveLength(1);
    const full = recordSetup({ existing: done, branchesToday: 3 });
    await full.service.recordCompletion(p);
    expect(full.grants).toHaveLength(0);
    const firstToday = recordSetup({
      existing: { completedAt: new Date() },
      branchesToday: 2,
    });
    await firstToday.service.recordCompletion(p);
    expect(firstToday.grants).toHaveLength(0);
  });
});

describe('containsQuizBlock', () => {
  it('finds nested quiz nodes only', () => {
    expect(
      containsQuizBlock({ type: 'doc', content: [{ type: 'quizOption' }] }),
    ).toBe(false);
    expect(
      containsQuizBlock({
        type: 'doc',
        content: [{ type: 'x', content: [{ type: 'quiz' }] }],
      }),
    ).toBe(true);
    expect(containsQuizBlock(null)).toBe(false);
  });
});
