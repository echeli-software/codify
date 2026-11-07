import { pickDailyQuests, seededRandom } from './quest-picker.js';
import { QuestsService, localHour } from './quests.service.js';

const t = (id: string, difficulty: number, weight?: number) => ({
  id,
  difficulty,
  weight,
});

describe('pickDailyQuests', () => {
  const pool = [
    t('e1', 1),
    t('e2', 1),
    t('e3', 1),
    t('m1', 2),
    t('m2', 2),
    t('h1', 3),
    t('h2', 3, 5),
  ];

  it('picks one per difficulty band', () => {
    const picks = pickDailyQuests(pool, 'u1:2026-10-07', 3);
    expect(picks.map((p) => p.difficulty)).toEqual([1, 2, 3]);
  });

  it('is stable for the same seed and input order independent', () => {
    const a = pickDailyQuests(pool, 'u1:2026-10-07', 3).map((p) => p.id);
    const b = pickDailyQuests([...pool].reverse(), 'u1:2026-10-07', 3).map(
      (p) => p.id,
    );
    expect(a).toEqual(b);
  });

  it('varies across users/days', () => {
    const sets = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      sets.add(
        pickDailyQuests(pool, `u1:2026-10-${String(d).padStart(2, '0')}`, 3)
          .map((p) => p.id)
          .join(','),
      );
    }
    expect(sets.size).toBeGreaterThan(3);
  });

  it('respects weights (≤ 0 never drawn; heavier drawn more)', () => {
    let heavy = 0;
    for (let i = 0; i < 2000; i++) {
      const picks = pickDailyQuests(
        [t('h1', 3, 1), t('h2', 3, 9), t('h0', 3, 0)],
        `s${i}`,
        1,
      );
      expect(picks[0].id).not.toBe('h0');
      if (picks[0].id === 'h2') heavy += 1;
    }
    expect(heavy / 2000).toBeGreaterThan(0.8);
    expect(heavy / 2000).toBeLessThan(0.97);
  });

  it('fills up to count from the remaining pool and never repeats', () => {
    const picks = pickDailyQuests(pool, 'seed', 5);
    expect(picks).toHaveLength(5);
    expect(new Set(picks.map((p) => p.id)).size).toBe(5);
  });

  it('handles empty bands and small pools', () => {
    expect(pickDailyQuests([t('m1', 2)], 's', 3).map((p) => p.id)).toEqual([
      'm1',
    ]);
    expect(pickDailyQuests([], 's', 3)).toEqual([]);
  });

  it('seededRandom is deterministic', () => {
    const a = seededRandom('x');
    const b = seededRandom('x');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('QuestsService.preassignForNewDay', () => {
  it('assigns only in zones whose local hour is 0, idempotently', async () => {
    // 2026-10-07T03:30Z → 00:30 in São Paulo (UTC-3), 03:30 in UTC.
    const now = new Date('2026-10-07T03:30:00Z');
    expect(localHour(now, 'America/Sao_Paulo')).toBe(0);
    const assignments: {
      userId: string;
      templateId: string;
      assignedFor: Date;
    }[] = [];
    const prisma = {
      user: {
        findMany: jest.fn(
          async (args: {
            distinct?: string[];
            where: { timezone?: string };
          }) => {
            if (args.distinct)
              return [{ timezone: 'America/Sao_Paulo' }, { timezone: 'UTC' }];
            return args.where.timezone === 'America/Sao_Paulo'
              ? [{ id: 'u1' }, { id: 'u2' }]
              : [{ id: 'u3' }];
          },
        ),
      },
      questTemplate: {
        findMany: async () => [
          { id: 'e1', difficulty: 1 },
          { id: 'm1', difficulty: 2 },
          { id: 'h1', difficulty: 3 },
        ],
      },
      questAssignment: {
        count: async ({
          where,
        }: {
          where: { userId: string; assignedFor: Date };
        }) =>
          assignments.filter(
            (a) =>
              a.userId === where.userId &&
              +a.assignedFor === +where.assignedFor,
          ).length,
        createMany: async ({ data }: { data: typeof assignments }) => {
          assignments.push(...data);
          return { count: data.length };
        },
      },
    };
    const config = { get: async () => 3 };
    const svc = new QuestsService(
      prisma as never,
      {} as never,
      config as never,
    );

    const first = await svc.preassignForNewDay(now);
    expect(first).toEqual({ timezones: 1, users: 2, assigned: 6 });
    expect(
      assignments.every(
        (a) => a.assignedFor.toISOString() === '2026-10-07T00:00:00.000Z',
      ),
    ).toBe(true);
    expect(assignments.some((a) => a.userId === 'u3')).toBe(false);

    const again = await svc.preassignForNewDay(now);
    expect(again.assigned).toBe(0);
  });
});
