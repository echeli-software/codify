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

  it('GOLD also needs every completed lesson reviewed up to box 3', () => {
    const lvl = (reviewBoxes: number[]) =>
      masteryLevel({
        lessonsTotal: 4,
        lessonsCompleted: 4,
        scorePct: 95,
        reviewBoxes,
      });
    expect(lvl([3, 4, 5])).toBe('GOLD');
    expect(lvl([])).toBe('GOLD'); // nothing to review (no quizzes)
    // SILVER and BRONZE don't depend on reviews.
    expect(lvl([3, 2])).toBe('SILVER');
    expect(lvl([1])).toBe('SILVER');
    expect(
      masteryLevel({
        lessonsTotal: 4,
        lessonsCompleted: 1,
        scorePct: 50,
        reviewBoxes: [1],
      }),
    ).toBe('BRONZE');
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
      // No missing cards to create; l1 (a quiz) has one, due already.
      $queryRaw: jest.fn(async () => []),
      reviewCard: {
        createMany: jest.fn(),
        findMany: jest.fn(async () => [
          { lessonId: 'l1', box: 2, dueAt: new Date('2026-11-01T00:00:00Z') },
        ]),
      },
    };
    const svc = new MasteryService(prisma as never);
    const res = await svc.forUser('u1', new Date('2026-11-08T00:00:00Z'));
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.reviewCard.createMany).not.toHaveBeenCalled();
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
    expect(web.reviews).toEqual({ cards: 1, due: 1, mastered: 0 });
    expect(web.courses[0].reviews).toEqual({ cards: 1, due: 1, mastered: 0 });
    expect(res.reviewsDue).toBe(1);
  });

  it('holds GOLD back until the reviews reach box 3', async () => {
    const run = async (box: number) => {
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
                  lessons: [{ id: 'l1', type: 'QUIZ', exerciseId: null }],
                },
              ],
            },
          ]),
        },
        category: {
          findMany: jest.fn(async () => [
            { id: 'cat1', slug: 'web', name: 'Web', iconName: null },
          ]),
        },
        progress: { findMany: jest.fn(async () => [{ lessonId: 'l1' }]) },
        quizAttempt: {
          groupBy: jest.fn(async () => [
            { lessonId: 'l1', _max: { scorePct: 100 } },
          ]),
        },
        submission: { groupBy: jest.fn(async () => []) },
        contentTranslation: { findMany: jest.fn(async () => []) },
        $queryRaw: jest.fn(async () => [
          { lessonId: 'l1', completedAt: new Date('2026-11-01T00:00:00Z') },
        ]),
        reviewCard: {
          createMany: jest.fn(async () => ({ count: 1 })),
          findMany: jest.fn(async () => [
            { lessonId: 'l1', box, dueAt: new Date('2026-12-01T00:00:00Z') },
          ]),
        },
      };
      const res = await new MasteryService(prisma as never).forUser(
        'u1',
        new Date('2026-11-08T00:00:00Z'),
      );
      return { res, prisma };
    };
    const early = await run(2);
    expect(early.res.topics[0].mastery).toBe('SILVER');
    expect(early.res.reviewsDue).toBe(0);
    // The completed quiz lesson got its card lazily: box 1, due +1 day.
    expect(early.prisma.reviewCard.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u1',
          lessonId: 'l1',
          box: 1,
          dueAt: new Date('2026-11-02T00:00:00Z'),
        },
      ],
      skipDuplicates: true,
    });
    const later = await run(3);
    expect(later.res.topics[0].mastery).toBe('GOLD');
    expect(later.res.topics[0].reviews).toEqual({
      cards: 1,
      due: 0,
      mastered: 1,
    });
  });
});
