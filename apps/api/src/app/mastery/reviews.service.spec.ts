import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsService, quizOnlyDoc } from './reviews.service.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-08T12:00:00Z');

const quiz = (id: string, correct: string) => ({
  type: 'quiz',
  attrs: {
    id,
    question: `Question ${id}?`,
    kind: 'single',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctOptionIds: [correct],
    explanation: `Because ${correct}`,
  },
});
const lessonDoc = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
    quiz('q1', 'a'),
    quiz('q2', 'b'),
  ],
};

const course = {
  id: 'c1',
  slug: 'js',
  sourceLocale: 'pt-BR',
  categories: [{ category: { id: 'cat1', slug: 'web', name: 'Web' } }],
};

function setup(
  opts: {
    card?: unknown;
    granted?: boolean;
    locale?: string;
    translation?: unknown;
  } = {},
) {
  const card =
    opts.card === undefined
      ? {
          id: 'card1',
          lessonId: 'l1',
          box: 2,
          dueAt: new Date(now.getTime() - DAY),
          reviews: 1,
          lapses: 0,
          lesson: {
            contentJson: lessonDoc,
            module: { courseId: 'c1', course },
          },
        }
      : opts.card;
  const prisma = {
    $queryRaw: jest.fn(async () => []),
    reviewCard: {
      createMany: jest.fn(),
      count: jest.fn(async () => 3),
      findFirst: jest.fn(async (args: { where: { dueAt?: unknown } }) =>
        args.where.dueAt ? { dueAt: new Date(now.getTime() + DAY) } : card,
      ),
      findMany: jest.fn(async () => (card ? [card] : [])),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    contentTranslation: {
      findMany: jest.fn(async (args: { where: { field: unknown } }) =>
        args.where.field === 'contentJson'
          ? opts.translation
            ? [{ entityId: 'l1', value: JSON.stringify(opts.translation) }]
            : []
          : [
              { entityId: 'l1', locale: 'pt-BR', value: 'Lição' },
              { entityId: 'c1', locale: 'pt-BR', value: 'Curso' },
            ],
      ),
    },
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({
      access: { granted: opts.granted ?? true, reason: 'plan_required' },
      courseId: 'c1',
    })),
  };
  const mastery = {
    forUser: jest.fn(async () => ({
      topics: [
        {
          categoryId: 'cat1',
          slug: 'web',
          name: 'Web',
          mastery: 'SILVER',
          courses: [{ courseId: 'c1' }],
        },
        {
          categoryId: 'cat2',
          slug: 'data',
          name: 'Data',
          mastery: 'GOLD',
          courses: [{ courseId: 'c9' }],
        },
      ],
      totals: {},
      reviewsDue: 2,
    })),
  };
  const localizer = {
    requestLocale: jest.fn(async () => opts.locale ?? 'pt-BR'),
    localize: jest.fn(async () => ({
      text: (_t: string, _id: string, _f: string, fallback: string) =>
        `${fallback}*`,
    })),
  };
  const svc = new ReviewsService(
    prisma as never,
    access as never,
    mastery as never,
    localizer as never,
  );
  return { svc, prisma, access, mastery };
}

describe('quizOnlyDoc', () => {
  it('keeps only the quiz blocks', () => {
    const doc = quizOnlyDoc(lessonDoc as never);
    expect(doc.content.map((b) => b.type)).toEqual(['quiz', 'quiz']);
    expect(doc.version).toBe(1);
  });
});

describe('ReviewsService.queue (docs/10 §7)', () => {
  it('returns due cards with stripped questions and titles', async () => {
    const { svc, prisma } = setup();
    const q = await svc.queue('u1', 5, now);
    expect(prisma.$queryRaw).toHaveBeenCalled(); // lazy card creation
    expect(prisma.reviewCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          dueAt: { lte: now },
        }),
        orderBy: [{ dueAt: 'asc' }, { lessonId: 'asc' }],
        take: 5,
      }),
    );
    expect(q.dueCount).toBe(3);
    expect(q.nextDueAt).toBe(new Date(now.getTime() + DAY).toISOString());
    expect(q.items).toHaveLength(1);
    const item = q.items[0];
    expect(item).toEqual(
      expect.objectContaining({
        lessonId: 'l1',
        lessonTitle: 'Lição',
        courseTitle: 'Curso',
        courseSlug: 'js',
        box: 2,
        questionCount: 2,
        topics: [{ categoryId: 'cat1', slug: 'web', name: 'Web*' }],
      }),
    );
    // The answer key never leaves the server.
    expect(JSON.stringify(item.doc)).not.toContain('correctOptionIds');
    expect(JSON.stringify(item.doc)).not.toContain('Because');
    expect(item.doc.content).toHaveLength(2);
  });

  it('serves an up-to-date translation of the questions', async () => {
    const translated = JSON.parse(JSON.stringify(lessonDoc));
    translated.content[1].attrs.question = 'Pergunta traduzida?';
    const { svc } = setup({ locale: 'en-US', translation: translated });
    const q = await svc.queue('u1', 10, now);
    expect(JSON.stringify(q.items[0].doc)).toContain('Pergunta traduzida?');
  });

  it('skips cards the learner can no longer open, or without a quiz', async () => {
    expect((await setup({ granted: false }).svc.queue('u1')).items).toEqual([]);
    const noQuiz = setup({
      card: {
        id: 'card1',
        lessonId: 'l1',
        box: 1,
        dueAt: now,
        reviews: 0,
        lapses: 0,
        lesson: {
          contentJson: { type: 'doc', version: 1, content: [] },
          module: { courseId: 'c1', course },
        },
      },
    });
    expect((await noQuiz.svc.queue('u1', 10, now)).items).toEqual([]);
  });

  it('clamps the page size', async () => {
    const { svc, prisma } = setup();
    await svc.queue('u1', 500, now);
    expect(prisma.reviewCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});

describe('ReviewsService.submit', () => {
  it('grades server-side; a pass moves the card up a box', async () => {
    const { svc, prisma } = setup();
    const res = await svc.submit('u1', 'l1', { q1: ['a'], q2: ['b'] }, now);
    expect(prisma.reviewCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'card1', reviews: 1, dueAt: new Date(now.getTime() - DAY) },
      data: {
        box: 3,
        dueAt: new Date(now.getTime() + 7 * DAY),
        reviews: 2,
        lapses: 0,
        lastResult: true,
        lastReviewedAt: now,
      },
    });
    expect(res).toEqual(
      expect.objectContaining({
        lessonId: 'l1',
        scorePct: 100,
        passed: true,
        passThresholdPct: 70,
        dueCount: 3,
        card: {
          previousBox: 2,
          box: 3,
          dueAt: new Date(now.getTime() + 7 * DAY).toISOString(),
          reviews: 2,
          lapses: 0,
        },
        // Only the topics of this lesson's course.
        topics: [
          { categoryId: 'cat1', slug: 'web', name: 'Web', mastery: 'SILVER' },
        ],
      }),
    );
    expect(res.perQuestion[0]).toEqual({
      id: 'q1',
      correct: true,
      correctOptionIds: ['a'],
      explanation: 'Because a',
    });
  });

  it('a miss drops the card to box 1 for tomorrow and counts a lapse', async () => {
    const { svc, prisma } = setup();
    const res = await svc.submit('u1', 'l1', { q1: ['a'], q2: ['a'] }, now);
    expect(res.passed).toBe(false);
    expect(res.scorePct).toBe(50);
    expect(res.card).toEqual(
      expect.objectContaining({ box: 1, lapses: 1, previousBox: 2 }),
    );
    expect(prisma.reviewCard.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          box: 1,
          dueAt: new Date(now.getTime() + DAY),
          lastResult: false,
        }),
      }),
    );
  });

  it('refuses a card that does not exist or is not due', async () => {
    await expect(
      setup({ card: null }).svc.submit('u1', 'l1', {}, now),
    ).rejects.toBeInstanceOf(NotFoundException);
    const early = setup({
      card: {
        id: 'card1',
        box: 1,
        dueAt: new Date(now.getTime() + DAY),
        reviews: 0,
        lapses: 0,
        lesson: { contentJson: lessonDoc, module: { courseId: 'c1' } },
      },
    });
    const err = await early.svc.submit('u1', 'l1', {}, now).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'review.not_due' }),
    );
    expect(early.prisma.reviewCard.updateMany).not.toHaveBeenCalled();
  });

  it('loses a race to a concurrent review with 409', async () => {
    const { svc, prisma, mastery } = setup();
    prisma.reviewCard.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      svc.submit('u1', 'l1', { q1: ['a'] }, now),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mastery.forUser).not.toHaveBeenCalled();
  });

  it('402s without access and 400s when the quiz is gone', async () => {
    const err = await setup({ granted: false })
      .svc.submit('u1', 'l1', {}, now)
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
    const noQuiz = setup({
      card: {
        id: 'card1',
        box: 1,
        dueAt: now,
        reviews: 0,
        lapses: 0,
        lesson: {
          contentJson: { type: 'doc', version: 1, content: [] },
          module: { courseId: 'c1' },
        },
      },
    });
    await expect(noQuiz.svc.submit('u1', 'l1', {}, now)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
