import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  LESSON_DOC_VERSION,
  extractQuizzes,
  gradeQuiz,
  migrateLessonDoc,
  sanitizeQuizAnswers,
  stripQuizAnswers,
  type LessonDoc,
} from '@codify/lesson-schema';
import { AccessService } from '../billing/access.service.js';
import { contentTitles } from '../leagues/learner-stats.js';
import { checkTranslatedBody } from '../lessons/lesson-content.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import { MasteryService } from './mastery.service.js';
import { ensureReviewCards } from './review-cards.js';
import {
  REVIEW_QUEUE_DEFAULT,
  REVIEW_QUEUE_MAX,
  type ReviewCardView,
  type ReviewQueue,
  type ReviewResult,
} from './reviews.dto.js';
import { REVIEW_PASS_PCT, isDue, nextReview } from './reviews.logic.js';

/** Cards of lessons a student can still see (live lesson, published course). */
const LIVE_LESSON = {
  lesson: {
    deletedAt: null,
    module: {
      deletedAt: null,
      course: { status: 'PUBLISHED', deletedAt: null },
    },
  },
} satisfies Prisma.ReviewCardWhereInput;

/** Only the quiz blocks of a doc, as a doc the lesson renderer can show. */
export function quizOnlyDoc(doc: LessonDoc): LessonDoc {
  return {
    type: 'doc',
    version: doc.version ?? LESSON_DOC_VERSION,
    ...(doc.attrs ? { attrs: doc.attrs } : {}),
    content: extractQuizzes(doc).map((attrs) => ({ type: 'quiz', attrs })),
  };
}

/**
 * Spaced-repetition reviews (docs/10 §7): the due queue and server-side
 * grading of a review. A review re-asks a completed lesson's quiz blocks,
 * graded with the quiz grader against the stored answer key; the result
 * moves the card between Leitner boxes (`reviews.logic.ts`). Reviews pay
 * no XP or coins (the earning rules have no review reward) and are not
 * quiz attempts, so they never change a lesson's best score.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly mastery: MasteryService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  /** `GET /me/reviews`: the due cards, oldest first, with their questions. */
  async queue(
    userId: string,
    limit = REVIEW_QUEUE_DEFAULT,
    now = new Date(),
  ): Promise<ReviewQueue> {
    await ensureReviewCards(this.prisma, userId);
    const take = Math.min(Math.max(1, Math.trunc(limit)), REVIEW_QUEUE_MAX);
    const due = { userId, dueAt: { lte: now }, ...LIVE_LESSON };
    const [dueCount, next, rows] = await Promise.all([
      this.prisma.reviewCard.count({ where: due }),
      this.prisma.reviewCard.findFirst({
        where: { userId, dueAt: { gt: now }, ...LIVE_LESSON },
        orderBy: { dueAt: 'asc' },
        select: { dueAt: true },
      }),
      this.prisma.reviewCard.findMany({
        where: due,
        orderBy: [{ dueAt: 'asc' }, { lessonId: 'asc' }],
        take,
        select: {
          lessonId: true,
          box: true,
          dueAt: true,
          reviews: true,
          lapses: true,
          lesson: {
            select: {
              contentJson: true,
              module: {
                select: {
                  course: {
                    select: {
                      id: true,
                      slug: true,
                      sourceLocale: true,
                      categories: {
                        select: {
                          category: {
                            select: { id: true, slug: true, name: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const locale = (await this.localizer?.requestLocale()) ?? null;
    const lessonSource = new Map(
      rows.map((r) => [r.lessonId, r.lesson.module.course.sourceLocale]),
    );
    const courseSource = new Map(
      rows.map((r) => [
        r.lesson.module.course.id,
        r.lesson.module.course.sourceLocale,
      ]),
    );
    const categories = new Map(
      rows.flatMap((r) =>
        r.lesson.module.course.categories.map((c) => [
          c.category.id,
          c.category,
        ]),
      ),
    );
    const [lessonTitles, courseTitles, bodies, tr] = await Promise.all([
      contentTitles(this.prisma, 'LESSON', lessonSource, locale ?? ''),
      contentTitles(this.prisma, 'COURSE', courseSource, locale ?? ''),
      locale
        ? this.prisma.contentTranslation.findMany({
            where: {
              entityType: 'LESSON',
              entityId: { in: [...lessonSource.keys()] },
              locale,
              field: 'contentJson',
              outdated: false,
            },
            select: { entityId: true, value: true },
          })
        : Promise.resolve([]),
      this.localizer?.localize([
        {
          entityType: 'CATEGORY',
          items: [...categories.values()].map((c) => ({
            id: c.id,
            values: { name: c.name },
          })),
        },
      ]),
    ]);
    const bodyOf = new Map(bodies.map((b) => [b.entityId, b.value]));

    const items: ReviewCardView[] = [];
    for (const r of rows) {
      const course = r.lesson.module.course;
      // Same access rule as the lesson itself (a lapsed plan hides it).
      const { access } = await this.access.resolveLessonAccess(
        userId,
        r.lessonId,
      );
      if (!access.granted) continue;
      const source = migrateLessonDoc(
        r.lesson.contentJson as unknown as LessonDoc,
        { validate: null },
      );
      // The caller's locale when an up-to-date, structurally equal
      // translation exists (quiz and option ids are kept), else the source.
      const body = locale !== course.sourceLocale && bodyOf.get(r.lessonId);
      const translated = body ? checkTranslatedBody(source, body) : null;
      const doc = quizOnlyDoc(translated?.ok ? translated.doc : source);
      if (doc.content.length === 0) continue; // the quiz was removed
      items.push({
        lessonId: r.lessonId,
        lessonTitle: lessonTitles.get(r.lessonId) ?? null,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: courseTitles.get(course.id) ?? null,
        topics: course.categories.map(({ category: c }) => ({
          categoryId: c.id,
          slug: c.slug,
          name: tr?.text('CATEGORY', c.id, 'name', c.name) ?? c.name,
        })),
        box: r.box,
        dueAt: r.dueAt.toISOString(),
        reviews: r.reviews,
        lapses: r.lapses,
        doc: stripQuizAnswers(doc),
        questionCount: doc.content.length,
      });
    }
    return {
      dueCount,
      nextDueAt: next?.dueAt.toISOString() ?? null,
      items,
    };
  }

  /**
   * `POST /me/reviews/:lessonId`: grade a due card server-side and move it
   * between boxes. 404 `review.not_found` (no card / lesson gone), 409
   * `review.not_due` (not due yet, or a concurrent review won), 402 when
   * the lesson is no longer accessible, 400 `NO_QUIZ` when its quiz was
   * removed.
   */
  async submit(
    userId: string,
    lessonId: string,
    answers: Record<string, unknown>,
    now = new Date(),
  ): Promise<ReviewResult> {
    await ensureReviewCards(this.prisma, userId);
    const card = await this.prisma.reviewCard.findFirst({
      where: { userId, lessonId, ...LIVE_LESSON },
      select: {
        id: true,
        box: true,
        dueAt: true,
        reviews: true,
        lapses: true,
        lesson: {
          select: {
            contentJson: true,
            module: { select: { courseId: true } },
          },
        },
      },
    });
    if (!card)
      throw new NotFoundException({
        code: 'review.not_found',
        message: 'Nothing to review for this lesson',
      });
    if (!isDue(card.dueAt, now))
      throw new ConflictException({
        code: 'review.not_due',
        message: 'This review is not due yet',
        dueAt: card.dueAt.toISOString(),
      });
    const { access } = await this.access.resolveLessonAccess(userId, lessonId);
    if (!access.granted)
      throw new HttpException(
        {
          statusCode: 402,
          message: 'Subscription required',
          reason: access.reason,
          requiredPlans: access.requiredPlans ?? [],
        },
        402,
      );
    const doc = migrateLessonDoc(
      card.lesson.contentJson as unknown as LessonDoc,
      { validate: null },
    );
    if (extractQuizzes(doc).length === 0)
      throw new BadRequestException({
        code: 'NO_QUIZ',
        message: 'This lesson has no quiz to review',
      });

    const grade = gradeQuiz(doc, sanitizeQuizAnswers(doc, answers), {
      passThresholdPct: REVIEW_PASS_PCT,
    });
    const next = nextReview(card, grade.scorePct, now);
    // Optimistic: only the review that still sees the card as it was wins.
    const { count } = await this.prisma.reviewCard.updateMany({
      where: { id: card.id, reviews: card.reviews, dueAt: card.dueAt },
      data: {
        box: next.box,
        dueAt: next.dueAt,
        reviews: next.reviews,
        lapses: next.lapses,
        lastResult: next.passed,
        lastReviewedAt: now,
      },
    });
    if (count === 0)
      throw new ConflictException({
        code: 'review.not_due',
        message: 'This review was just submitted',
      });

    const [view, dueCount] = await Promise.all([
      this.mastery.forUser(userId, now),
      this.prisma.reviewCard.count({
        where: { userId, dueAt: { lte: now }, ...LIVE_LESSON },
      }),
    ]);
    const courseId = card.lesson.module.courseId;
    return {
      lessonId,
      scorePct: grade.scorePct,
      passed: next.passed,
      correctCount: grade.correctCount,
      totalCount: grade.totalCount,
      passThresholdPct: REVIEW_PASS_PCT,
      perQuestion: grade.perQuestion.map((q) => ({
        id: q.id,
        correct: q.correct,
        correctOptionIds: q.correctOptionIds,
        explanation: q.explanation,
      })),
      card: {
        previousBox: card.box,
        box: next.box,
        dueAt: next.dueAt.toISOString(),
        reviews: next.reviews,
        lapses: next.lapses,
      },
      topics: view.topics
        .filter((t) => t.courses.some((c) => c.courseId === courseId))
        .map((t) => ({
          categoryId: t.categoryId,
          slug: t.slug,
          name: t.name,
          mastery: t.mastery,
        })),
      dueCount,
    };
  }
}
