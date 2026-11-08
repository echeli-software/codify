import { BadRequestException } from '@nestjs/common';
import {
  BadgesService,
  evalRule,
  validateBadgeRule,
  whereKey,
} from './badges.service.js';

describe('validateBadgeRule', () => {
  it('accepts the docs examples, including where filters', () => {
    // docs/07 §7 "Prompt Pro" and "Comeback".
    expect(
      validateBadgeRule({
        all: [
          {
            event: 'ai_prompt_pass',
            where: { scorePct: { gte: 80 } },
            count: { gte: 10 },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      validateBadgeRule({
        all: [{ event: 'lesson_complete', where: { afterStreakLost: true } }],
      }),
    ).toEqual([]);
    expect(
      validateBadgeRule({
        all: [{ event: 'lesson_complete', count: { gte: 1 } }],
      }),
    ).toEqual([]);
    expect(
      validateBadgeRule({ all: [{ metric: 'streak.current_days', gte: 7 }] }),
    ).toEqual([]);
    expect(validateBadgeRule({ any: [{ event: 'capstone_pass' }] })).toEqual(
      [],
    );
    expect(validateBadgeRule({ any: [] })).toEqual([]);
  });
  it('rejects unknown events/metrics, bad predicates and shapes', () => {
    expect(
      validateBadgeRule({
        all: [{ event: 'lesson_completed', count: { gte: 1 } }],
      }),
    ).toHaveLength(1);
    expect(
      validateBadgeRule({ all: [{ metric: 'nope', gte: 1 }] }),
    ).toHaveLength(1);
    expect(
      validateBadgeRule({ all: [{ metric: 'streak.current_days' }] }),
    ).toHaveLength(1);
    expect(
      validateBadgeRule({ all: [{ event: 'quiz_pass', count: { gte: '3' } }] }),
    ).toHaveLength(1);
    expect(validateBadgeRule({ all: [] })).toHaveLength(1);
    expect(validateBadgeRule({ all: [], any: [] })).toHaveLength(1);
    expect(validateBadgeRule([])).toHaveLength(1);
  });
  it('lists every where-filter problem', () => {
    const errs = (where: unknown, event = 'ai_prompt_pass', count?: unknown) =>
      validateBadgeRule({
        all: [{ event, where, ...(count ? { count } : {}) }],
      });
    expect(errs({ scorePct: { gte: 'x' } })).toEqual([
      'all[0].where.scorePct.gte must be a number',
    ]);
    expect(errs({ scorePct: {} })).toEqual([
      'all[0].where.scorePct: needs a predicate (gte/lte/gt/lt/eq)',
    ]);
    expect(errs({ scorePct: { gte: 80 } }, 'lesson_complete')).toEqual([
      'all[0].where.scorePct only applies to ai_prompt_pass, quiz_pass, exercise_pass',
    ]);
    expect(errs({ afterStreakLost: 'yes' }, 'lesson_complete')).toEqual([
      'all[0].where.afterStreakLost must be true',
    ]);
    expect(
      errs({ afterStreakLost: true }, 'lesson_complete', { gte: 3 }),
    ).toEqual([
      'all[0].where.afterStreakLost can only be counted once (count ≤ 1)',
    ]);
    expect(errs({ color: 'red' })).toEqual([
      'all[0].where.color is not a supported filter (scorePct, afterStreakLost)',
    ]);
    expect(errs({})).toEqual(['all[0].where needs at least one filter']);
    expect(errs([])).toEqual(['all[0].where must be an object']);
    expect(
      validateBadgeRule({
        all: [{ metric: 'streak.current_days', gte: 1, where: {} }],
      }),
    ).toEqual(['all[0].where is only allowed on "event" clauses']);
  });
});

describe('where filters', () => {
  const promptPro = {
    all: [
      {
        event: 'ai_prompt_pass',
        where: { scorePct: { gte: 80 } },
        count: { gte: 10 },
      },
    ],
  };
  it('evalRule reads the filtered count, not the raw event count', () => {
    const key = whereKey('ai_prompt_pass', { scorePct: { gte: 80 } });
    const base = { events: { ai_prompt_pass: 12 }, metrics: {} };
    expect(evalRule(promptPro, { ...base, filtered: { [key]: 9 } })).toBe(
      false,
    );
    expect(evalRule(promptPro, { ...base, filtered: { [key]: 10 } })).toBe(
      true,
    );
  });

  it('computeFiltered counts scorePct passes in SQL and afterStreakLost from the event / streak', async () => {
    const tx = {
      $queryRaw: jest.fn(async () => [{ count: 4n }]),
    };
    const svc = new BadgesService({} as never, {} as never);
    const comeback = {
      all: [{ event: 'lesson_complete', where: { afterStreakLost: true } }],
    };
    const metrics = {
      events: { ai_prompt_pass: 7, lesson_complete: 20 },
      metrics: { 'streak.current_days': 3, 'streak.longest_days': 3 },
    };
    const out = await svc.computeFiltered(
      tx as never,
      'u1',
      [promptPro as never, comeback as never],
      metrics,
      null,
    );
    expect(out[whereKey('ai_prompt_pass', { scorePct: { gte: 80 } })]).toBe(4);
    expect(out[whereKey('lesson_complete', { afterStreakLost: true })]).toBe(0);
    // The SQL binds the predicate value.
    const sql = (tx.$queryRaw.mock.calls[0] as unknown[]).flat();
    expect(JSON.stringify(sql)).toMatch(/scorePct/);
    // This completion restarted a lost streak → Comeback.
    const now = await svc.computeFiltered(
      tx as never,
      'u1',
      [comeback as never],
      metrics,
      { type: 'lesson_complete', afterStreakLost: true },
    );
    expect(now[whereKey('lesson_complete', { afterStreakLost: true })]).toBe(1);
    // Or the stored streak shows a loss followed by activity.
    const durable = await svc.computeFiltered(
      tx as never,
      'u1',
      [comeback as never],
      {
        ...metrics,
        metrics: { 'streak.current_days': 2, 'streak.longest_days': 9 },
      },
      null,
    );
    expect(
      durable[whereKey('lesson_complete', { afterStreakLost: true })],
    ).toBe(1);
  });
});

describe('evalRule', () => {
  const m = {
    events: { exercise_pass: 3, quiz_pass: 0 },
    metrics: { 'streak.current_days': 7 },
  };
  it('evaluates all/any with default count ≥ 1', () => {
    expect(
      evalRule({ all: [{ event: 'exercise_pass', count: { gte: 3 } }] }, m),
    ).toBe(true);
    expect(evalRule({ all: [{ event: 'quiz_pass' } as never] }, m)).toBe(false);
    expect(
      evalRule(
        {
          any: [
            { event: 'quiz_pass' } as never,
            { metric: 'streak.current_days', gte: 7 },
          ],
        },
        m,
      ),
    ).toBe(true);
    expect(evalRule({ any: [] }, m)).toBe(false);
  });
});

describe('BadgesService.computeMetrics', () => {
  it('maps journal counts to the DSL events', async () => {
    const tx = {
      progress: { count: async () => 12 },
      streak: { findUnique: async () => ({ currentDays: 4, longestDays: 9 }) },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ count: 2n }])
        .mockResolvedValueOnce([
          {
            exercisePass: 5n,
            aiPromptPass: 3n,
            scenarioComplete: 2n,
            quizPass: 4n,
            capstoneLessons: 1n,
            capstoneCerts: 1n,
          },
        ]),
    };
    const svc = new BadgesService({} as never, {} as never);
    const metrics = await svc.computeMetrics(tx as never, 'u1');
    expect(metrics.events).toEqual({
      lesson_complete: 12,
      exercise_pass: 5,
      ai_prompt_pass: 3,
      scenario_complete: 2,
      quiz_pass: 4,
      capstone_pass: 1,
    });
    expect(metrics.metrics['categories.completed']).toBe(2);
    expect(metrics.metrics['streak.longest_days']).toBe(9);
  });
});

describe('BadgesService admin edit', () => {
  const badge = { id: 'b1', slug: 'first', name: 'First' };
  const prisma = {
    badge: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) =>
          where.id === 'b1'
            ? badge
            : where.slug === 'taken'
              ? { id: 'b2' }
              : null,
      ),
      update: jest.fn(async ({ data }: { data: object }) => ({
        ...badge,
        ...data,
      })),
      create: jest.fn(),
    },
  };
  const svc = new BadgesService(prisma as never, {} as never);

  it('PATCH can change slug and rule', async () => {
    const res = await svc.updateBadge('b1', {
      slug: 'first-steps',
      rule: { all: [{ event: 'lesson_complete', count: { gte: 1 } }] },
    });
    expect(res.slug).toBe('first-steps');
  });
  it('rejects a taken slug and an invalid rule', async () => {
    await expect(svc.updateBadge('b1', { slug: 'taken' })).rejects.toThrow(
      'Slug already in use',
    );
    await expect(
      svc.updateBadge('b1', { rule: { all: [] } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.createBadge({
        slug: 'x',
        name: 'X',
        rule: { all: [{ event: 'bogus' } as never] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
