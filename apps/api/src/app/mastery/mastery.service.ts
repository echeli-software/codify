import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import { contentTitles } from '../leagues/learner-stats.js';
import {
  average,
  masteryLevel,
  moduleStates,
  type MasteryLevel,
  type SkillNodeState,
} from './mastery.logic.js';
import { ensureReviewCards } from './review-cards.js';
import { GOLD_MIN_BOX, isDue } from './reviews.logic.js';

export interface SkillNode {
  moduleId: string;
  order: number;
  title: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  state: SkillNodeState;
  /** The module that unlocks this one (LOCKED nodes only). */
  prerequisiteModuleId: string | null;
}

/** Spaced-repetition review cards of the completed lessons (docs/10 §7). */
export interface ReviewSummary {
  /** Completed lessons with a review card (lessons with a quiz). */
  cards: number;
  /** Cards due now. */
  due: number;
  /** Cards in box ≥ 3 — GOLD needs all of them there. */
  mastered: number;
}

export interface MasteryCourse {
  courseId: string;
  slug: string;
  title: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  scorePct: number | null;
  mastery: MasteryLevel;
  reviews: ReviewSummary;
  nodes: SkillNode[];
}

export interface MasteryTopic {
  /** Category id, or null for courses without a category. */
  categoryId: string | null;
  slug: string | null;
  name: string | null;
  iconName: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  /** Average of the best quiz / exercise score per graded lesson. */
  scorePct: number | null;
  mastery: MasteryLevel;
  reviews: ReviewSummary;
  courses: MasteryCourse[];
}

export interface MasteryView {
  topics: MasteryTopic[];
  totals: Record<MasteryLevel, number>;
  /** Review cards due now across every topic (`GET /me/reviews`). */
  reviewsDue: number;
}

interface CourseCalc {
  view: MasteryCourse;
  lessonIds: string[];
  scores: number[];
}

/**
 * `GET /me/mastery` (docs/10 §7): per-topic (category) mastery from
 * completed lessons, quiz / exercise results and spaced-repetition review
 * cards, and a skill tree per published course (modules as nodes). A
 * handful of queries regardless of catalog size; the only write is the
 * lazy creation of missing review cards.
 */
@Injectable()
export class MasteryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  async forUser(userId: string, now = new Date()): Promise<MasteryView> {
    await ensureReviewCards(this.prisma, userId);
    const [courses, categories] = await Promise.all([
      this.prisma.course.findMany({
        where: { status: 'PUBLISHED', deletedAt: null },
        orderBy: { publishedAt: 'asc' },
        select: {
          id: true,
          slug: true,
          sourceLocale: true,
          categories: { select: { categoryId: true } },
          modules: {
            where: { deletedAt: null },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              lessons: {
                where: { deletedAt: null },
                orderBy: { order: 'asc' },
                select: { id: true, type: true, exerciseId: true },
              },
            },
          },
        },
      }),
      this.prisma.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, slug: true, name: true, iconName: true },
      }),
    ]);
    const lessonIds = courses.flatMap((c) =>
      c.modules.flatMap((m) => m.lessons.map((l) => l.id)),
    );
    const exerciseIds = courses.flatMap((c) =>
      c.modules.flatMap((m) =>
        m.lessons.flatMap((l) => (l.exerciseId ? [l.exerciseId] : [])),
      ),
    );
    const [done, quiz, exercise, cardRows] = await Promise.all([
      this.prisma.progress.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: { lessonId: true },
      }),
      this.prisma.quizAttempt.groupBy({
        by: ['lessonId'],
        where: { userId, lessonId: { in: lessonIds } },
        _max: { scorePct: true },
      }),
      exerciseIds.length
        ? this.prisma.submission.groupBy({
            by: ['exerciseId'],
            where: { userId, scored: true, exerciseId: { in: exerciseIds } },
            _max: { scorePct: true },
          })
        : Promise.resolve([]),
      this.prisma.reviewCard.findMany({
        where: { userId, lessonId: { in: lessonIds } },
        select: { lessonId: true, box: true, dueAt: true },
      }),
    ]);
    const cards = new Map(cardRows.map((c) => [c.lessonId, c]));
    /** Review boxes + summary of the completed lessons among `ids`. */
    const reviewsOf = (ids: Iterable<string>) => {
      const boxes: number[] = [];
      const summary: ReviewSummary = { cards: 0, due: 0, mastered: 0 };
      for (const id of ids) {
        const card = completed.has(id) ? cards.get(id) : undefined;
        if (!card) continue;
        boxes.push(card.box);
        summary.cards += 1;
        if (isDue(card.dueAt, now)) summary.due += 1;
        if (card.box >= GOLD_MIN_BOX) summary.mastered += 1;
      }
      return { boxes, summary };
    };
    const completed = new Set(done.map((d) => d.lessonId));
    const quizBest = new Map(quiz.map((q) => [q.lessonId, q._max.scorePct]));
    const exBest = new Map(
      exercise.map((e) => [e.exerciseId, e._max.scorePct]),
    );

    const locale = (await this.localizer?.requestLocale()) ?? 'pt-BR';
    const [courseTitles, moduleTitles, tr] = await Promise.all([
      contentTitles(
        this.prisma,
        'COURSE',
        new Map(courses.map((c) => [c.id, c.sourceLocale])),
        locale,
      ),
      contentTitles(
        this.prisma,
        'MODULE',
        new Map(
          courses.flatMap((c) => c.modules.map((m) => [m.id, c.sourceLocale])),
        ),
        locale,
      ),
      this.localizer?.localize([
        {
          entityType: 'CATEGORY',
          items: categories.map((c) => ({
            id: c.id,
            values: { name: c.name },
          })),
        },
      ]),
    ]);

    const calcs = new Map<string, CourseCalc>();
    for (const c of courses) {
      const modules = c.modules.map((m) => ({
        moduleId: m.id,
        order: m.order,
        title: moduleTitles.get(m.id) ?? null,
        lessonsTotal: m.lessons.length,
        lessonsCompleted: m.lessons.filter((l) => completed.has(l.id)).length,
      }));
      const states = moduleStates(modules);
      const scores: number[] = [];
      for (const m of c.modules)
        for (const l of m.lessons) {
          const s =
            quizBest.get(l.id) ??
            (l.exerciseId ? exBest.get(l.exerciseId) : null);
          if (s !== null && s !== undefined) scores.push(s);
        }
      const ids = c.modules.flatMap((m) => m.lessons.map((l) => l.id));
      const lessonsCompleted = ids.filter((id) => completed.has(id)).length;
      const scorePct = average(scores);
      const reviews = reviewsOf(ids);
      calcs.set(c.id, {
        lessonIds: ids,
        scores,
        view: {
          courseId: c.id,
          slug: c.slug,
          title: courseTitles.get(c.id) ?? null,
          lessonsTotal: ids.length,
          lessonsCompleted,
          scorePct,
          mastery: masteryLevel({
            lessonsTotal: ids.length,
            lessonsCompleted,
            scorePct,
            reviewBoxes: reviews.boxes,
          }),
          reviews: reviews.summary,
          nodes: modules.map((m, i) => ({
            ...m,
            state: states[i],
            prerequisiteModuleId:
              states[i] === 'LOCKED'
                ? (modules[i - 1]?.moduleId ?? null)
                : null,
          })),
        },
      });
    }

    const topic = (
      cat: (typeof categories)[number] | null,
      courseIds: string[],
    ): MasteryTopic => {
      const parts = courseIds
        .map((id) => calcs.get(id))
        .filter((x): x is CourseCalc => !!x);
      const ids = new Set(parts.flatMap((p) => p.lessonIds));
      const lessonsCompleted = [...ids].filter((id) =>
        completed.has(id),
      ).length;
      const scorePct = average(parts.flatMap((p) => p.scores));
      const reviews = reviewsOf(ids);
      return {
        categoryId: cat?.id ?? null,
        slug: cat?.slug ?? null,
        name: cat
          ? (tr?.text('CATEGORY', cat.id, 'name', cat.name) ?? cat.name)
          : null,
        iconName: cat?.iconName ?? null,
        lessonsTotal: ids.size,
        lessonsCompleted,
        scorePct,
        mastery: masteryLevel({
          lessonsTotal: ids.size,
          lessonsCompleted,
          scorePct,
          reviewBoxes: reviews.boxes,
        }),
        reviews: reviews.summary,
        courses: parts.map((p) => p.view),
      };
    };

    const topics: MasteryTopic[] = [];
    for (const cat of categories) {
      const ids = courses
        .filter((c) => c.categories.some((x) => x.categoryId === cat.id))
        .map((c) => c.id);
      if (ids.length) topics.push(topic(cat, ids));
    }
    const loose = courses
      .filter((c) => c.categories.length === 0)
      .map((c) => c.id);
    if (loose.length) topics.push(topic(null, loose));

    const totals: Record<MasteryLevel, number> = {
      NONE: 0,
      BRONZE: 0,
      SILVER: 0,
      GOLD: 0,
    };
    for (const t of topics) totals[t.mastery] += 1;
    // Each card once, even when its course sits in several topics.
    const reviewsDue = reviewsOf(lessonIds).summary.due;
    return { topics, totals, reviewsDue };
  }
}
