import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { ContentTranslation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { assertCanManageCourse } from './course-ownership.js';
import { SUPPORTED_LOCALES } from '../translations/translations.logic.js';

export type FieldStatus = 'missing' | 'outdated' | 'done';

export interface CourseTranslationEntity {
  entityType: 'COURSE' | 'MODULE' | 'LESSON';
  entityId: string;
  /** Source-locale title (or a positional fallback). */
  label: string;
  /** field → locale → status, for every target locale. */
  fields: Record<string, Record<string, FieldStatus>>;
}

export interface CourseTranslationsReport {
  sourceLocale: string;
  locales: {
    locale: string;
    total: number;
    done: number;
    outdated: number;
    missing: number;
    /** Done ÷ total, 0–100 (100 when nothing needs translating). */
    pct: number;
  }[];
  entities: CourseTranslationEntity[];
}

export interface CourseAnalyticsReport {
  courseId: string;
  generatedAt: string;
  lessonCount: number;
  /** enrolled → started (≥ 1 lesson) → 50 % → completed (every live lesson). */
  funnel: {
    enrolled: number;
    started: number;
    half: number;
    completed: number;
  };
  lessons: {
    lessonId: string;
    moduleId: string;
    title: string;
    /** Distinct learners with a `lesson_open` event (last 90 days). */
    opened: number;
    completed: number;
    /** Share lost vs the previous lesson's completions (0–100, null for the first). */
    dropOffPct: number | null;
  }[];
  /** Free → paid conversion by how the learner enrolled (docs/04 Analytics). */
  conversions: { source: string; enrolled: number; convertedToPaid: number }[];
}

export interface CourseEnrollmentRow {
  /** Stable pseudonym (hash of user + course); TEACHERs see only this. */
  learner: string;
  /** Real identity — ADMIN only, null for TEACHER. */
  userId: string | null;
  displayName: string | null;
  source: string;
  enrolledAt: string;
  completedLessons: number;
  lastCompletedAt: string | null;
}

export interface CourseMultiplierRow {
  id: string;
  kind: string;
  target: string;
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  lessonId: string | null;
  description: string | null;
  isActive: boolean;
  activeNow: boolean;
}

const OPEN_WINDOW_MS = 90 * 86_400_000;

/** Translation status of one field for one target locale. */
export function fieldStatus(
  rows: Pick<ContentTranslation, 'locale' | 'value' | 'outdated'>[],
  locale: string,
): FieldStatus {
  const row = rows.find((r) => r.locale === locale);
  if (!row || !row.value) return 'missing';
  return row.outdated ? 'outdated' : 'done';
}

/** Pseudonymous learner label: stable per course, not reversible. */
export function learnerAlias(userId: string, courseId: string): string {
  const h = createHash('sha256')
    .update(`${courseId}:${userId}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `L-${h}`;
}

/**
 * Read-only course insights for the course detail tabs (docs/04 Course →
 * Translations / Analytics / Promotions / enrollments): ADMIN, or a TEACHER
 * on their own course (docs/04 §1).
 */
@Injectable()
export class CourseInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  private async course(actor: ApiUser, courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true, authorId: true, sourceLocale: true, slug: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    assertCanManageCourse(actor, course);
    return course;
  }

  private async tree(courseId: string) {
    return this.prisma.module.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        order: true,
        lessons: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
          select: { id: true, order: true },
        },
      },
    });
  }

  // ─── Translations ──────────────────────────────────────────────────────

  async translations(
    actor: ApiUser,
    courseId: string,
  ): Promise<CourseTranslationsReport> {
    const course = await this.course(actor, courseId);
    const modules = await this.tree(courseId);
    const lessons = modules.flatMap((m) => m.lessons);
    const rows = await this.prisma.contentTranslation.findMany({
      where: {
        OR: [
          { entityType: 'COURSE', entityId: courseId },
          { entityType: 'MODULE', entityId: { in: modules.map((m) => m.id) } },
          { entityType: 'LESSON', entityId: { in: lessons.map((l) => l.id) } },
        ],
      },
    });
    const targets = SUPPORTED_LOCALES.filter((l) => l !== course.sourceLocale);
    const entities: CourseTranslationEntity[] = [];
    const add = (
      entityType: CourseTranslationEntity['entityType'],
      entityId: string,
      fallback: string,
      fields: string[],
      sourceAlwaysPresent: string[] = [],
    ) => {
      const mine = rows.filter(
        (r) => r.entityType === entityType && r.entityId === entityId,
      );
      const label =
        mine.find(
          (r) => r.field === 'title' && r.locale === course.sourceLocale,
        )?.value ?? fallback;
      const out: CourseTranslationEntity['fields'] = {};
      for (const field of fields) {
        const fieldRows = mine.filter((r) => r.field === field);
        const hasSource =
          sourceAlwaysPresent.includes(field) ||
          fieldRows.some((r) => r.locale === course.sourceLocale && !!r.value);
        if (!hasSource) continue; // nothing to translate
        out[field] = Object.fromEntries(
          targets.map((l) => [l, fieldStatus(fieldRows, l)]),
        );
      }
      entities.push({ entityType, entityId, label, fields: out });
    };
    add('COURSE', courseId, course.slug, ['title', 'description']);
    for (const m of modules) {
      add('MODULE', m.id, `Module ${m.order + 1}`, ['title']);
      for (const l of m.lessons)
        // The lesson body's source lives in Lesson.contentJson.
        add(
          'LESSON',
          l.id,
          `Lesson ${l.order + 1}`,
          ['title', 'contentJson'],
          ['contentJson'],
        );
    }
    const locales = targets.map((locale) => {
      let total = 0;
      let done = 0;
      let outdated = 0;
      for (const e of entities)
        for (const byLocale of Object.values(e.fields)) {
          total += 1;
          const s = byLocale[locale];
          if (s === 'done') done += 1;
          else if (s === 'outdated') outdated += 1;
        }
      return {
        locale,
        total,
        done,
        outdated,
        missing: total - done - outdated,
        pct: total === 0 ? 100 : Math.round((done / total) * 100),
      };
    });
    return { sourceLocale: course.sourceLocale, locales, entities };
  }

  /**
   * Course ids (of `courseIds`) with at least one missing or outdated
   * translation in a target locale — the courses list "has missing
   * translations" filter. Lesson bodies count as present in the source.
   */
  async incompleteCourseIds(courseIds: string[]): Promise<Set<string>> {
    if (courseIds.length === 0) return new Set();
    const courses = await this.prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: {
        id: true,
        sourceLocale: true,
        modules: {
          where: { deletedAt: null },
          select: {
            id: true,
            lessons: { where: { deletedAt: null }, select: { id: true } },
          },
        },
      },
    });
    const owner = new Map<string, { courseId: string; source: string }>();
    for (const c of courses) {
      owner.set(`COURSE|${c.id}`, { courseId: c.id, source: c.sourceLocale });
      for (const m of c.modules) {
        owner.set(`MODULE|${m.id}`, { courseId: c.id, source: c.sourceLocale });
        for (const l of m.lessons)
          owner.set(`LESSON|${l.id}`, {
            courseId: c.id,
            source: c.sourceLocale,
          });
      }
    }
    const ids = (t: string) =>
      [...owner.keys()]
        .filter((k) => k.startsWith(`${t}|`))
        .map((k) => k.slice(t.length + 1));
    const rows = await this.prisma.contentTranslation.findMany({
      where: {
        OR: [
          { entityType: 'COURSE', entityId: { in: ids('COURSE') } },
          { entityType: 'MODULE', entityId: { in: ids('MODULE') } },
          { entityType: 'LESSON', entityId: { in: ids('LESSON') } },
        ],
        field: { in: ['title', 'description', 'contentJson'] },
      },
      select: {
        entityType: true,
        entityId: true,
        field: true,
        locale: true,
        value: true,
        outdated: true,
      },
    });
    const byField = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.entityType}|${r.entityId}|${r.field}`;
      byField.set(k, [...(byField.get(k) ?? []), r]);
    }
    const out = new Set<string>();
    for (const [key, info] of owner) {
      if (out.has(info.courseId)) continue;
      const [type] = key.split('|');
      const fields =
        type === 'COURSE'
          ? ['title', 'description']
          : type === 'MODULE'
            ? ['title']
            : ['title', 'contentJson'];
      for (const f of fields) {
        const fr = byField.get(`${key}|${f}`) ?? [];
        const hasSource =
          (type === 'LESSON' && f === 'contentJson') ||
          fr.some((r) => r.locale === info.source && !!r.value);
        if (!hasSource) continue;
        if (
          SUPPORTED_LOCALES.some(
            (l) => l !== info.source && fieldStatus(fr, l) !== 'done',
          )
        ) {
          out.add(info.courseId);
          break;
        }
      }
    }
    return out;
  }

  // ─── Analytics ─────────────────────────────────────────────────────────

  async analytics(
    actor: ApiUser,
    courseId: string,
    now = new Date(),
  ): Promise<CourseAnalyticsReport> {
    const course = await this.course(actor, courseId);
    const modules = await this.tree(courseId);
    const lessons = modules.flatMap((m) =>
      m.lessons.map((l) => ({ ...l, moduleId: m.id })),
    );
    const lessonIds = lessons.map((l) => l.id);
    const [enrollments, progress, opened, titles] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { courseId },
        select: { userId: true, source: true, createdAt: true },
      }),
      lessonIds.length
        ? this.prisma.progress.findMany({
            where: { lessonId: { in: lessonIds } },
            select: { userId: true, lessonId: true },
          })
        : Promise.resolve([]),
      lessonIds.length
        ? this.prisma.$queryRaw<{ lid: string; users: bigint }[]>`
            SELECT e.props->>'lessonId' AS lid, COUNT(DISTINCT e."userId") AS users
              FROM "AnalyticsEvent" e
             WHERE e.name = 'lesson_open' AND e."userId" IS NOT NULL
               AND e."occurredAt" >= ${new Date(now.getTime() - OPEN_WINDOW_MS)}
               AND e.props->>'lessonId' = ANY(${lessonIds})
             GROUP BY 1`
        : Promise.resolve([]),
      this.prisma.contentTranslation.findMany({
        where: {
          entityType: 'LESSON',
          entityId: { in: lessonIds },
          field: 'title',
          locale: course.sourceLocale,
        },
        select: { entityId: true, value: true },
      }),
    ]);
    const perUser = new Map<string, number>();
    const perLesson = new Map<string, number>();
    for (const p of progress) {
      perUser.set(p.userId, (perUser.get(p.userId) ?? 0) + 1);
      perLesson.set(p.lessonId, (perLesson.get(p.lessonId) ?? 0) + 1);
    }
    const total = lessons.length;
    const counts = [...perUser.values()];
    const half = Math.ceil(total / 2);
    const openedBy = new Map(opened.map((o) => [o.lid, Number(o.users)]));
    const titleBy = new Map(titles.map((t) => [t.entityId, t.value]));

    let prev: number | null = null;
    const lessonRows = lessons.map((l) => {
      const completed = perLesson.get(l.id) ?? 0;
      const dropOffPct =
        prev === null || prev === 0
          ? null
          : Math.max(0, Math.round((1 - completed / prev) * 100));
      prev = completed;
      return {
        lessonId: l.id,
        moduleId: l.moduleId,
        title: titleBy.get(l.id) ?? `Lesson ${l.order + 1}`,
        opened: openedBy.get(l.id) ?? 0,
        completed,
        dropOffPct,
      };
    });

    // Conversions: enrolled learners whose first paid (non-grant)
    // subscription started after they enrolled.
    const enrolledIds = enrollments.map((e) => e.userId);
    const subs = enrolledIds.length
      ? await this.prisma.subscription.findMany({
          where: {
            userId: { in: enrolledIds },
            source: { not: 'ADMIN_GRANT' },
            status: { notIn: ['INCOMPLETE', 'INCOMPLETE_EXPIRED'] },
          },
          select: { userId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const firstPaid = new Map<string, Date>();
    for (const s of subs)
      if (!firstPaid.has(s.userId)) firstPaid.set(s.userId, s.createdAt);
    const bySource = new Map<string, { enrolled: number; converted: number }>();
    for (const e of enrollments) {
      const row = bySource.get(e.source) ?? { enrolled: 0, converted: 0 };
      row.enrolled += 1;
      const paidAt = firstPaid.get(e.userId);
      if (paidAt && paidAt >= e.createdAt) row.converted += 1;
      bySource.set(e.source, row);
    }

    return {
      courseId,
      generatedAt: now.toISOString(),
      lessonCount: total,
      funnel: {
        enrolled: enrollments.length,
        started: counts.filter((n) => n >= 1).length,
        half: total === 0 ? 0 : counts.filter((n) => n >= half).length,
        completed: total === 0 ? 0 : counts.filter((n) => n >= total).length,
      },
      lessons: lessonRows,
      conversions: [...bySource.entries()].map(([source, r]) => ({
        source,
        enrolled: r.enrolled,
        convertedToPaid: r.converted,
      })),
    };
  }

  // ─── Enrollments (anonymised for TEACHER) ──────────────────────────────

  async enrollments(
    actor: ApiUser,
    courseId: string,
    opts: { skip: number; take: number },
  ): Promise<{ items: CourseEnrollmentRow[]; total: number }> {
    await this.course(actor, courseId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where: { courseId },
        orderBy: { createdAt: 'desc' },
        skip: opts.skip,
        take: opts.take,
        select: {
          userId: true,
          source: true,
          createdAt: true,
          user: { select: { displayName: true } },
        },
      }),
      this.prisma.enrollment.count({ where: { courseId } }),
    ]);
    const userIds = rows.map((r) => r.userId);
    const progress = userIds.length
      ? await this.prisma.progress.groupBy({
          by: ['userId'],
          where: {
            userId: { in: userIds },
            lesson: {
              deletedAt: null,
              module: { courseId, deletedAt: null },
            },
          },
          _count: { _all: true },
          _max: { completedAt: true },
        })
      : [];
    const byUser = new Map(progress.map((p) => [p.userId, p]));
    const isAdmin = actor.role === 'ADMIN';
    return {
      items: rows.map((r) => ({
        learner: learnerAlias(r.userId, courseId),
        userId: isAdmin ? r.userId : null,
        displayName: isAdmin ? r.user.displayName : null,
        source: r.source,
        enrolledAt: r.createdAt.toISOString(),
        completedLessons: byUser.get(r.userId)?._count._all ?? 0,
        lastCompletedAt:
          byUser.get(r.userId)?._max.completedAt?.toISOString() ?? null,
      })),
      total,
    };
  }

  // ─── Course-level multipliers (read-only for TEACHER) ──────────────────

  async multipliers(
    actor: ApiUser,
    courseId: string,
    now = new Date(),
  ): Promise<CourseMultiplierRow[]> {
    await this.course(actor, courseId);
    const lessonIds = (await this.tree(courseId)).flatMap((m) =>
      m.lessons.map((l) => l.id),
    );
    const rows = await this.prisma.multiplier.findMany({
      where: {
        userId: null,
        OR: [{ courseId }, { lessonId: { in: lessonIds } }],
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
    const t = now.getTime();
    return rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      target: m.target,
      value: Number(m.value),
      startsAt: m.startsAt?.toISOString() ?? null,
      endsAt: m.endsAt?.toISOString() ?? null,
      lessonId: m.lessonId,
      description: m.description,
      isActive: m.isActive,
      activeNow:
        m.isActive &&
        (!m.startsAt || m.startsAt.getTime() <= t) &&
        (!m.endsAt || m.endsAt.getTime() >= t),
    }));
  }
}
