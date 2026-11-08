import { average, masteryLevel, moduleStates } from './mastery.logic.js';
import { MasteryService } from './mastery.service.js';

describe('mastery rules (docs/10 §7)', () => {
  it('levels by completion share and average best score', () => {
    const lvl = (done: number, score: number | null, total = 10) =>
      masteryLevel({
        lessonsTotal: total,
        lessonsCompleted: done,
        scorePct: score,
      });
    expect(lvl(0, null)).toBe('NONE');
    expect(lvl(1, null, 0)).toBe('NONE');
    expect(lvl(1, null)).toBe('BRONZE');
    expect(lvl(5, 70)).toBe('SILVER');
    expect(lvl(5, 60)).toBe('BRONZE');
    expect(lvl(10, 90)).toBe('GOLD');
    expect(lvl(10, 80)).toBe('SILVER');
    expect(lvl(10, null)).toBe('GOLD');
  });

  it('averages', () => {
    expect(average([])).toBeNull();
    expect(average([90, 71])).toBe(81);
  });

  it('locks a module behind its unfinished predecessor', () => {
    expect(
      moduleStates([
        { lessonsTotal: 2, lessonsCompleted: 2 },
        { lessonsTotal: 3, lessonsCompleted: 1 },
        { lessonsTotal: 1, lessonsCompleted: 0 },
        { lessonsTotal: 0, lessonsCompleted: 0 },
      ]),
    ).toEqual(['COMPLETED', 'IN_PROGRESS', 'LOCKED', 'LOCKED']);
    expect(
      moduleStates([
        { lessonsTotal: 0, lessonsCompleted: 0 },
        { lessonsTotal: 2, lessonsCompleted: 0 },
      ]),
    ).toEqual(['AVAILABLE', 'AVAILABLE']);
  });
});

describe('MasteryService.forUser', () => {
  it('aggregates courses into topics with skill-tree nodes', async () => {
    const lesson = (id: string, exerciseId: string | null = null) => ({
      id,
      type: exerciseId ? 'EXERCISE' : 'QUIZ',
      exerciseId,
    });
    const prisma = {
      course: {
        findMany: jest.fn(async () => [
          {
            id: 'c1',
            slug: 'js',
            sourceLocale: 'pt-BR',
            categories: [{ categoryId: 'cat1' }],
            modules: [
              {
                id: 'm1',
                order: 1,
                lessons: [lesson('l1'), lesson('l2', 'e1')],
              },
              { id: 'm2', order: 2, lessons: [lesson('l3')] },
            ],
          },
          {
            id: 'c2',
            slug: 'loose',
            sourceLocale: 'pt-BR',
            categories: [],
            modules: [{ id: 'm3', order: 1, lessons: [lesson('l4')] }],
          },
        ]),
      },
      category: {
        findMany: jest.fn(async () => [
          { id: 'cat1', slug: 'web', name: 'Web', iconName: 'code' },
          { id: 'cat2', slug: 'empty', name: 'Empty', iconName: null },
        ]),
      },
      progress: {
        findMany: jest.fn(async () => [{ lessonId: 'l1' }, { lessonId: 'l2' }]),
      },
      quizAttempt: {
        groupBy: jest.fn(async () => [
          { lessonId: 'l1', _max: { scorePct: 100 } },
        ]),
      },
      submission: {
        groupBy: jest.fn(async () => [
          { exerciseId: 'e1', _max: { scorePct: 80 } },
        ]),
      },
      contentTranslation: {
        findMany: jest.fn(async () => [
          { entityId: 'c1', locale: 'pt-BR', value: 'JavaScript' },
          { entityId: 'm1', locale: 'pt-BR', value: 'Básico' },
        ]),
      },
    };
    const svc = new MasteryService(prisma as never);
    const res = await svc.forUser('u1');
    expect(res.topics).toHaveLength(2);
    const web = res.topics[0];
    expect(web).toEqual(
      expect.objectContaining({
        categoryId: 'cat1',
        name: 'Web',
        lessonsTotal: 3,
        lessonsCompleted: 2,
        scorePct: 90,
        mastery: 'SILVER',
      }),
    );
    expect(web.courses[0].nodes.map((n) => n.state)).toEqual([
      'COMPLETED',
      'AVAILABLE',
    ]);
    expect(web.courses[0].title).toBe('JavaScript');
    expect(res.topics[1]).toEqual(
      expect.objectContaining({ categoryId: null, mastery: 'NONE' }),
    );
    expect(res.totals).toEqual({ NONE: 1, BRONZE: 0, SILVER: 1, GOLD: 0 });
  });
});
