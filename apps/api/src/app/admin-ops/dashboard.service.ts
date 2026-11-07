import { Injectable } from '@nestjs/common';
import { currentWeekStart } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { TranslationsService } from '../translations/translations.service.js';
import type {
  AdminDashboardKpis,
  DashboardResponse,
  DropOffLessonView,
  TeacherDashboardKpis,
  TopCourseView,
} from './admin-ops.dto.js';
import { AuditReadService } from './audit-read.service.js';
import { resolveTitles } from './admin-ops.util.js';

const DAY_MS = 86_400_000;
/** Window for the teacher drop-off table. */
export const DROP_OFF_WINDOW_DAYS = 30;
/** Paid sources — admin grants are free access, not revenue. */
const PAID_SOURCES = ['STRIPE_WEB', 'APPLE_IAP', 'GOOGLE_PLAY'] as const;
/** Statuses a paying customer is in (MRR + active count). */
const PAYING_STATUSES = ['ACTIVE', 'PAST_DUE'] as const;

/** Billing period inferred from a subscription's current period length. */
export function inferPeriod(start: Date, end: Date): 'MONTHLY' | 'ANNUAL' {
  return end.getTime() - start.getTime() > 62 * DAY_MS ? 'ANNUAL' : 'MONTHLY';
}

/** Monthly value in cents of one price (annual spread over 12 months). */
export function monthlyCents(
  amountCents: number,
  period: 'MONTHLY' | 'ANNUAL',
): number {
  return period === 'ANNUAL' ? Math.round(amountCents / 12) : amountCents;
}

interface PriceRow {
  planId: string;
  currency: string;
  period: 'MONTHLY' | 'ANNUAL';
  amountCents: number;
  storeProductId: string | null;
}

interface SubRow {
  planId: string;
  storeProductId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * MRR in BRL cents from active subscriptions and plan prices. A store
 * subscription's period comes from its `storeProductId` price; otherwise
 * it is inferred from the period length. Subscriptions whose plan has no
 * BRL price for that period are counted in `excluded` — no FX conversion
 * is attempted (USD-only plans would need a rate source we don't have).
 */
export function computeMrr(
  subs: SubRow[],
  prices: PriceRow[],
): { amountCents: number; excluded: number } {
  let amountCents = 0;
  let excluded = 0;
  for (const s of subs) {
    const store = s.storeProductId
      ? prices.find((p) => p.storeProductId === s.storeProductId)
      : undefined;
    const period =
      store?.period ?? inferPeriod(s.currentPeriodStart, s.currentPeriodEnd);
    const brl =
      store?.currency === 'BRL'
        ? store
        : prices.find(
            (p) =>
              p.planId === s.planId &&
              p.currency === 'BRL' &&
              p.period === period,
          );
    if (!brl) excluded += 1;
    else amountCents += monthlyCents(brl.amountCents, brl.period);
  }
  return { amountCents, excluded };
}

/**
 * GET /admin/dashboard (docs/04 "Dashboard"). ADMIN/SUPPORT get the
 * business KPIs, TEACHER gets their own courses' numbers; both get the
 * latest audit activity (teachers: their own actions only).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translations: TranslationsService,
    private readonly audit: AuditReadService,
  ) {}

  async get(
    actor: ApiUser,
    locale: string,
    now = new Date(),
  ): Promise<DashboardResponse> {
    const weekStart = currentWeekStart(now);
    const teacher = actor.role === 'TEACHER';
    const [admin, teacherKpis, recentActivity] = await Promise.all([
      teacher ? null : this.adminKpis(locale, now, weekStart),
      teacher ? this.teacherKpis(actor.userId, locale, now) : null,
      this.audit.recent(actor, 20),
    ]);
    return {
      scope: teacher ? 'teacher' : 'admin',
      generatedAt: now.toISOString(),
      weekStart: weekStart.toISOString(),
      admin,
      teacher: teacherKpis,
      recentActivity,
    };
  }

  // ─── Admin scope ─────────────────────────────────────────────────────

  private async adminKpis(
    locale: string,
    now: Date,
    weekStart: Date,
  ): Promise<AdminDashboardKpis> {
    const [active, conversions, subs, trialing, prices, topCourses] =
      await Promise.all([
        this.activeUsers(now),
        this.paidConversionsSince(weekStart),
        this.prisma.subscription.findMany({
          where: {
            source: { in: [...PAID_SOURCES] },
            status: { in: [...PAYING_STATUSES] },
          },
          select: {
            planId: true,
            storeProductId: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
          },
        }),
        this.prisma.subscription.count({
          where: { source: { in: [...PAID_SOURCES] }, status: 'TRIALING' },
        }),
        this.prisma.planPrice.findMany({
          select: {
            planId: true,
            currency: true,
            period: true,
            amountCents: true,
            storeProductId: true,
          },
        }),
        this.topCourses(locale),
      ]);
    const mrr = computeMrr(subs, prices);
    return {
      wau: active.wau,
      mau: active.mau,
      paidConversionsThisWeek: conversions,
      activeSubscriptions: subs.length,
      trialingSubscriptions: trialing,
      mrr: {
        currency: 'BRL',
        amountCents: mrr.amountCents,
        excludedSubscriptions: mrr.excluded,
      },
      topCourses,
    };
  }

  /**
   * Distinct students seen (User.lastSeenAt) or with an analytics event
   * in the last 7 / 30 days.
   */
  private async activeUsers(now: Date): Promise<{ wau: number; mau: number }> {
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const rows = await this.prisma.$queryRaw<{ wau: bigint; mau: bigint }[]>`
      WITH active AS (
        SELECT u.id, u."lastSeenAt" AS at FROM "User" u
          WHERE u."deletedAt" IS NULL AND u.role = 'STUDENT'
            AND u."lastSeenAt" >= ${since30}
        UNION ALL
        SELECT e."userId", MAX(e."occurredAt") FROM "AnalyticsEvent" e
          JOIN "User" u ON u.id = e."userId"
          WHERE u."deletedAt" IS NULL AND u.role = 'STUDENT'
            AND e."occurredAt" >= ${since30} AND e."occurredAt" <= ${now}
          GROUP BY e."userId"
      )
      SELECT
        COUNT(DISTINCT id) FILTER (WHERE at >= ${since7}) AS wau,
        COUNT(DISTINCT id) AS mau
      FROM active`;
    return { wau: Number(rows[0]?.wau ?? 0), mau: Number(rows[0]?.mau ?? 0) };
  }

  /**
   * Users whose first paid subscription (non admin-grant, past trial and
   * checkout) was created since `since`.
   */
  private async paidConversionsSince(since: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT "userId", MIN("createdAt") AS first FROM "Subscription"
          WHERE source::text <> 'ADMIN_GRANT'
            AND status::text NOT IN ('TRIALING', 'INCOMPLETE', 'INCOMPLETE_EXPIRED')
          GROUP BY "userId"
      ) f WHERE f.first >= ${since}`;
    return Number(rows[0]?.n ?? 0);
  }

  /** Published courses ranked by learners who finished every lesson. */
  private async topCourses(locale: string): Promise<TopCourseView[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        slug: string;
        sourceLocale: string;
        enrolled: bigint;
        completed: bigint;
      }[]
    >`
      WITH lc AS (
        SELECT m."courseId", COUNT(l.id) AS n FROM "Lesson" l
          JOIN "Module" m ON m.id = l."moduleId"
          WHERE l."deletedAt" IS NULL GROUP BY m."courseId"
      ), up AS (
        SELECT m."courseId", p."userId", COUNT(*) AS done FROM "Progress" p
          JOIN "Lesson" l ON l.id = p."lessonId"
          JOIN "Module" m ON m.id = l."moduleId"
          WHERE l."deletedAt" IS NULL GROUP BY m."courseId", p."userId"
      )
      SELECT c.id, c.slug, c."sourceLocale",
        (SELECT COUNT(*) FROM "Enrollment" e WHERE e."courseId" = c.id) AS enrolled,
        COUNT(up."userId") FILTER (WHERE up.done >= lc.n) AS completed
      FROM "Course" c
        JOIN lc ON lc."courseId" = c.id
        LEFT JOIN up ON up."courseId" = c.id
      WHERE c."deletedAt" IS NULL AND c.status::text = 'PUBLISHED'
      GROUP BY c.id, c.slug, c."sourceLocale"
      ORDER BY completed DESC, enrolled DESC, c.slug ASC
      LIMIT 5`;
    const titles = await resolveTitles(
      this.prisma,
      'COURSE',
      new Map(rows.map((r) => [r.id, r.sourceLocale])),
      locale,
    );
    return rows.map((r) => {
      const enrolled = Number(r.enrolled);
      const completed = Number(r.completed);
      return {
        courseId: r.id,
        slug: r.slug,
        title: titles.get(r.id) ?? r.slug,
        enrolled,
        completed,
        completionRate: enrolled > 0 ? Math.min(1, completed / enrolled) : 0,
      };
    });
  }

  // ─── Teacher scope ───────────────────────────────────────────────────

  private async teacherKpis(
    authorId: string,
    locale: string,
    now: Date,
  ): Promise<TeacherDashboardKpis> {
    // "Today" is the UTC day, like every other server-side day boundary.
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [byCourse, dropOff, completeness] = await Promise.all([
      this.prisma.enrollment.groupBy({
        by: ['courseId'],
        where: {
          createdAt: { gte: today },
          course: { authorId, deletedAt: null },
        },
        _count: { _all: true },
      }),
      this.dropOff(authorId, locale, now),
      this.translations.completeness({ authorId }),
    ]);
    const courses = await this.prisma.course.findMany({
      where: { id: { in: byCourse.map((b) => b.courseId) } },
      select: { id: true, slug: true, sourceLocale: true },
    });
    const titles = await resolveTitles(
      this.prisma,
      'COURSE',
      new Map(courses.map((c) => [c.id, c.sourceLocale])),
      locale,
    );
    const pendingTranslations = Object.values(completeness.locales).reduce(
      (sum, l) => sum + (l.ALL.total - l.ALL.translated),
      0,
    );
    const enrollmentsTodayByCourse = byCourse
      .map((b) => ({
        courseId: b.courseId,
        title:
          titles.get(b.courseId) ??
          courses.find((c) => c.id === b.courseId)?.slug ??
          b.courseId,
        count: b._count._all,
      }))
      .sort((a, b) => b.count - a.count);
    return {
      enrollmentsToday: enrollmentsTodayByCourse.reduce(
        (s, c) => s + c.count,
        0,
      ),
      enrollmentsTodayByCourse,
      topDropOffLessons: dropOff,
      pendingTranslations,
    };
  }

  /**
   * Own lessons ranked by drop-off over the last {@link DROP_OFF_WINDOW_DAYS}
   * days: of the learners who opened the lesson (`lesson_open` analytics
   * event), how many have not completed it (Progress).
   */
  private async dropOff(
    authorId: string,
    locale: string,
    now: Date,
  ): Promise<DropOffLessonView[]> {
    const since = new Date(now.getTime() - DROP_OFF_WINDOW_DAYS * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      {
        lessonId: string;
        courseSlug: string;
        sourceLocale: string;
        started: bigint;
        completed: bigint;
      }[]
    >`
      WITH opened AS (
        SELECT DISTINCT e.props->>'lessonId' AS lid, e."userId" AS uid
          FROM "AnalyticsEvent" e
          WHERE e.name = 'lesson_open' AND e."userId" IS NOT NULL
            AND e."occurredAt" >= ${since}
      )
      SELECT l.id AS "lessonId", c.slug AS "courseSlug", c."sourceLocale",
        COUNT(o.uid) AS started, COUNT(p.id) AS completed
      FROM opened o
        JOIN "Lesson" l ON l.id = o.lid
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "Course" c ON c.id = m."courseId"
        LEFT JOIN "Progress" p ON p."lessonId" = l.id AND p."userId" = o.uid
      WHERE c."authorId" = ${authorId}
        AND c."deletedAt" IS NULL AND l."deletedAt" IS NULL
      GROUP BY l.id, c.slug, c."sourceLocale"
      ORDER BY (COUNT(o.uid) - COUNT(p.id))::float / COUNT(o.uid) DESC,
        COUNT(o.uid) DESC
      LIMIT 5`;
    const titles = await resolveTitles(
      this.prisma,
      'LESSON',
      new Map(rows.map((r) => [r.lessonId, r.sourceLocale])),
      locale,
    );
    return rows.map((r) => {
      const started = Number(r.started);
      const completed = Number(r.completed);
      return {
        lessonId: r.lessonId,
        title: titles.get(r.lessonId) ?? r.lessonId,
        courseSlug: r.courseSlug,
        started,
        completed,
        dropOffRate: started > 0 ? Math.max(0, 1 - completed / started) : 0,
      };
    });
  }
}
