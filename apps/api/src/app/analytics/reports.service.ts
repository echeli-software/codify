import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { currentWeekStart } from '@codify/domain';
import type { ApiUser } from '../auth/auth.types.js';
import { computeMrr } from '../admin-ops/dashboard.service.js';
import { resolveTitles } from '../admin-ops/admin-ops.util.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;
/** Weeks of history in the weekly series. */
export const REPORT_WEEKS = 8;
/** Signup cohorts (weeks) in the retention table. */
export const RETENTION_COHORTS = 10;
/** Reports are recomputed at most this often per instance. */
export const REPORT_CACHE_MS = 10 * 60 * 1000;
const PAID_SOURCES = ['STRIPE_WEB', 'APPLE_IAP', 'GOOGLE_PLAY'] as const;

export interface RetentionCohort {
  /** UTC Monday of the signup week (ISO). */
  cohortStart: string;
  size: number;
  /** Share of the measurable members active on day N after signup (null until one is measurable). */
  d1: number | null;
  d7: number | null;
  d30: number | null;
  /** Members old enough to be measured on each day. */
  eligible: { d1: number; d7: number; d30: number };
}

export interface LeagueWeek {
  weekStart: string;
  members: number;
  /** Members with weekly XP > 0. */
  activeMembers: number;
  /** Students active that week (any lesson / XP / analytics event). */
  activeStudents: number;
  /** activeMembers / activeStudents (0–1, null with no active students). */
  participation: number | null;
  promoted: number;
  demoted: number;
}

export interface ShopWeek {
  weekStart: string;
  /** Coins spent in the shop (items + chests). */
  coinsSpent: number;
  purchases: number;
  buyers: number;
}

export interface PlanMrr {
  planId: string;
  planName: string;
  /** BRL cents (annual ÷ 12). */
  amountCents: number;
  subscriptions: number;
  /** Subscriptions without a BRL price (no FX conversion). */
  excluded: number;
}

export interface BillingWeek {
  weekStart: string;
  /** Subscriptions whose first payment landed this week. */
  newPaid: number;
  /** Paid subscriptions whose access ended this week. */
  churned: number;
  netNew: number;
}

export interface CurrencyAmount {
  currency: string;
  amountCents: number;
}

export interface BillingReport {
  mrr: { currency: 'BRL'; amountCents: number; byPlan: PlanMrr[] };
  weeks: BillingWeek[];
  /** Trials that ended in the last 90 days and how many paid afterwards. */
  trialToPaid: { trialsEnded: number; converted: number; rate: number | null };
  /** Last 30 days, per currency: net revenue / paying users. */
  arppu: {
    currency: string;
    revenueCents: number;
    payingUsers: number;
    arppuCents: number;
  }[];
  /** Last 90 days, per currency: refunded / paid. */
  refunds: {
    currency: string;
    paidCents: number;
    refundedCents: number;
    payments: number;
    refundedPayments: number;
    /** refundedCents / paidCents (0–1). */
    rate: number | null;
  }[];
}

export interface OverviewReport {
  generatedAt: string;
  retention: RetentionCohort[];
  leagues: LeagueWeek[];
  shop: ShopWeek[];
  billing: BillingReport;
}

export interface CourseFunnelRow {
  courseId: string;
  slug: string;
  title: string;
  status: string;
  lessons: number;
  /** Enrollment rows ∪ learners with any completed lesson. */
  enrolled: number;
  /** Learners who completed at least one lesson. */
  started: number;
  /** Learners who completed every live lesson. */
  completed: number;
}

export interface LessonFunnelRow {
  lessonId: string;
  title: string;
  /** 1-based position in the course (module order, then lesson order). */
  position: number;
  type: string;
  /** Distinct learners who opened it (`lesson_open`, last 90 days). */
  opened: number;
  /** Distinct learners who completed it (ever). */
  completed: number;
  /** Completions lost since the previous lesson (≥ 0). */
  dropOff: number;
  /** dropOff / previous lesson's completions (0–1; null for the first lesson). */
  dropOffRate: number | null;
}

/**
 * Read-only reporting for the admin Analytics page (docs/04 "Analytics",
 * docs/09 §13, docs/10 §10), computed from the existing tables — no
 * separate warehouse. Results are cached per instance for
 * REPORT_CACHE_MS instead of being precomputed nightly (the spec's
 * "precomputed nightly" — a cache gives the same load profile without a
 * new table).
 *
 * Scope: the overview (retention, leagues, shop, billing) is ADMIN only;
 * course funnels are ADMIN (every course) or TEACHER (own courses).
 */
@Injectable()
export class ReportsService {
  private cache: { at: number; value: OverviewReport } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async overview(now = new Date(), fresh = false): Promise<OverviewReport> {
    if (!fresh && this.cache && now.getTime() - this.cache.at < REPORT_CACHE_MS)
      return this.cache.value;
    const [retention, leagues, shop, billing] = await Promise.all([
      this.retention(now),
      this.leagueWeeks(now),
      this.shopWeeks(now),
      this.billing(now),
    ]);
    const value = {
      generatedAt: now.toISOString(),
      retention,
      leagues,
      shop,
      billing,
    };
    this.cache = { at: now.getTime(), value };
    return value;
  }

  // ─── Retention ───────────────────────────────────────────────────────

  async retention(now: Date): Promise<RetentionCohort[]> {
    const firstWeek = new Date(
      currentWeekStart(now).getTime() - (RETENTION_COHORTS - 1) * 7 * DAY_MS,
    );
    const today = utcDay(now);
    const rows = await this.prisma.$queryRaw<
      {
        wk: Date;
        size: bigint;
        d1: bigint;
        d7: bigint;
        d30: bigint;
        e1: bigint;
        e7: bigint;
        e30: bigint;
      }[]
    >`
      WITH cohort AS (
        SELECT id, date_trunc('week', "createdAt") AS wk, "createdAt"::date AS d0
        FROM "User"
        WHERE role::text = 'STUDENT' AND "createdAt" >= ${firstWeek}
      ), act AS (
        SELECT DISTINCT "userId" AS uid, "occurredAt"::date AS d FROM "AnalyticsEvent"
          WHERE "userId" IN (SELECT id FROM cohort)
        UNION
        SELECT DISTINCT "userId", "completedAt"::date FROM "Progress"
          WHERE "userId" IN (SELECT id FROM cohort)
        UNION
        SELECT DISTINCT "userId", "createdAt"::date FROM "XpEvent"
          WHERE "userId" IN (SELECT id FROM cohort)
      )
      SELECT c.wk, COUNT(*) AS size,
        COUNT(*) FILTER (WHERE c.d0 + 1 < ${today}::date AND EXISTS (SELECT 1 FROM act a WHERE a.uid = c.id AND a.d = c.d0 + 1)) AS d1,
        COUNT(*) FILTER (WHERE c.d0 + 7 < ${today}::date AND EXISTS (SELECT 1 FROM act a WHERE a.uid = c.id AND a.d = c.d0 + 7)) AS d7,
        COUNT(*) FILTER (WHERE c.d0 + 30 < ${today}::date AND EXISTS (SELECT 1 FROM act a WHERE a.uid = c.id AND a.d = c.d0 + 30)) AS d30,
        COUNT(*) FILTER (WHERE c.d0 + 1 < ${today}::date) AS e1,
        COUNT(*) FILTER (WHERE c.d0 + 7 < ${today}::date) AS e7,
        COUNT(*) FILTER (WHERE c.d0 + 30 < ${today}::date) AS e30
      FROM cohort c
      GROUP BY c.wk
      ORDER BY c.wk ASC`;
    return rows.map((r) => {
      const e = { d1: Number(r.e1), d7: Number(r.e7), d30: Number(r.e30) };
      const size = Number(r.size);
      // Only members already past day N are measured.
      const rate = (n: bigint, eligible: number) =>
        eligible > 0 ? Number(n) / eligible : null;
      return {
        cohortStart: new Date(r.wk).toISOString(),
        size,
        d1: rate(r.d1, e.d1),
        d7: rate(r.d7, e.d7),
        d30: rate(r.d30, e.d30),
        eligible: e,
      };
    });
  }

  // ─── Leagues + shop ──────────────────────────────────────────────────

  async leagueWeeks(now: Date): Promise<LeagueWeek[]> {
    const weeks = weekStarts(now);
    const from = weeks[0];
    const [members, active] = await Promise.all([
      this.prisma.$queryRaw<
        {
          wk: Date;
          members: bigint;
          active: bigint;
          promoted: bigint;
          demoted: bigint;
        }[]
      >`
        SELECT l."weekStart" AS wk, COUNT(*) AS members,
          COUNT(*) FILTER (WHERE m."weeklyXp" > 0) AS active,
          COUNT(*) FILTER (WHERE m.promoted IS TRUE) AS promoted,
          COUNT(*) FILTER (WHERE m.demoted IS TRUE) AS demoted
        FROM "LeagueMembership" m JOIN "League" l ON l.id = m."leagueId"
        WHERE l."weekStart" >= ${from}
        GROUP BY l."weekStart"`,
      this.activeStudentsPerWeek(from),
    ]);
    return weeks.map((w) => {
      const m = members.find((r) => sameDay(r.wk, w));
      const students = active.get(w.toISOString().slice(0, 10)) ?? 0;
      const activeMembers = Number(m?.active ?? 0);
      return {
        weekStart: w.toISOString(),
        members: Number(m?.members ?? 0),
        activeMembers,
        activeStudents: students,
        participation:
          students > 0 ? Math.min(1, activeMembers / students) : null,
        promoted: Number(m?.promoted ?? 0),
        demoted: Number(m?.demoted ?? 0),
      };
    });
  }

  private async activeStudentsPerWeek(
    from: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ wk: Date; n: bigint }[]>`
      WITH act AS (
        SELECT "userId" AS uid, date_trunc('week', "createdAt") AS wk FROM "XpEvent" WHERE "createdAt" >= ${from}
        UNION
        SELECT "userId", date_trunc('week', "completedAt") FROM "Progress" WHERE "completedAt" >= ${from}
        UNION
        SELECT "userId", date_trunc('week', "occurredAt") FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "userId" IS NOT NULL
      )
      SELECT act.wk, COUNT(DISTINCT act.uid) AS n
      FROM act JOIN "User" u ON u.id = act.uid AND u.role::text = 'STUDENT'
      GROUP BY act.wk`;
    return new Map(
      rows.map((r) => [new Date(r.wk).toISOString().slice(0, 10), Number(r.n)]),
    );
  }

  async shopWeeks(now: Date): Promise<ShopWeek[]> {
    const weeks = weekStarts(now);
    const rows = await this.prisma.$queryRaw<
      { wk: Date; coins: bigint; purchases: bigint; buyers: bigint }[]
    >`
      SELECT date_trunc('week', "createdAt") AS wk,
        COALESCE(SUM(-delta), 0) AS coins, COUNT(*) AS purchases,
        COUNT(DISTINCT "userId") AS buyers
      FROM "CoinTransaction"
      WHERE source::text IN ('ITEM_PURCHASE', 'CHEST_PURCHASE') AND delta < 0
        AND "createdAt" >= ${weeks[0]}
      GROUP BY 1`;
    return weeks.map((w) => {
      const r = rows.find((x) => sameDay(x.wk, w));
      return {
        weekStart: w.toISOString(),
        coinsSpent: Number(r?.coins ?? 0),
        purchases: Number(r?.purchases ?? 0),
        buyers: Number(r?.buyers ?? 0),
      };
    });
  }

  // ─── Billing (docs/09 §13) ───────────────────────────────────────────

  async billing(now: Date): Promise<BillingReport> {
    const weeks = weekStarts(now);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since90 = new Date(now.getTime() - 90 * DAY_MS);
    const [subs, prices, plans, newPaid, churned, trials, arppu, refunds] =
      await Promise.all([
        this.prisma.subscription.findMany({
          where: {
            source: { in: [...PAID_SOURCES] },
            status: { in: ['ACTIVE', 'PAST_DUE'] },
          },
          select: {
            planId: true,
            storeProductId: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
          },
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
        this.prisma.plan.findMany({ select: { id: true, name: true } }),
        this.prisma.$queryRaw<{ wk: Date; n: bigint }[]>`
          SELECT date_trunc('week', f.first) AS wk, COUNT(*) AS n FROM (
            SELECT "subscriptionId", MIN("paidAt") AS first FROM "Payment"
            WHERE "subscriptionId" IS NOT NULL AND "paidAt" IS NOT NULL
              AND status::text <> 'FAILED'
            GROUP BY "subscriptionId"
          ) f WHERE f.first >= ${weeks[0]} GROUP BY 1`,
        this.prisma.$queryRaw<{ wk: Date; n: bigint }[]>`
          SELECT date_trunc('week', s."currentPeriodEnd") AS wk, COUNT(*) AS n
          FROM "Subscription" s
          WHERE s.status::text IN ('CANCELED', 'UNPAID')
            AND s."currentPeriodEnd" >= ${weeks[0]} AND s."currentPeriodEnd" <= ${now}
            AND s.source::text <> 'ADMIN_GRANT'
            AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."subscriptionId" = s.id
              AND p."paidAt" IS NOT NULL AND p.status::text <> 'FAILED')
          GROUP BY 1`,
        this.prisma.$queryRaw<{ ended: bigint; converted: bigint }[]>`
          SELECT COUNT(*) AS ended,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM "Payment" p WHERE p."subscriptionId" = s.id
                AND p."paidAt" >= s."trialEndsAt" - interval '1 day'
                AND p.status::text <> 'FAILED')) AS converted
          FROM "Subscription" s
          WHERE s."trialEndsAt" IS NOT NULL
            AND s."trialEndsAt" >= ${since90} AND s."trialEndsAt" <= ${now}`,
        this.prisma.$queryRaw<
          { currency: string; revenue: bigint; users: bigint }[]
        >`
          SELECT currency, COALESCE(SUM("amountCents" - "refundedCents"), 0) AS revenue,
            COUNT(DISTINCT "userId") AS users
          FROM "Payment"
          WHERE "paidAt" >= ${since30} AND status::text <> 'FAILED'
          GROUP BY currency ORDER BY currency`,
        this.prisma.$queryRaw<
          {
            currency: string;
            paid: bigint;
            refunded: bigint;
            n: bigint;
            nr: bigint;
          }[]
        >`
          SELECT currency, COALESCE(SUM("amountCents"), 0) AS paid,
            COALESCE(SUM("refundedCents"), 0) AS refunded, COUNT(*) AS n,
            COUNT(*) FILTER (WHERE "refundedCents" > 0) AS nr
          FROM "Payment"
          WHERE "paidAt" >= ${since90} AND status::text <> 'FAILED'
          GROUP BY currency ORDER BY currency`,
      ]);

    const total = computeMrr(subs, prices);
    const byPlan: PlanMrr[] = plans
      .map((p) => {
        const mine = subs.filter((s) => s.planId === p.id);
        const m = computeMrr(mine, prices);
        return {
          planId: p.id,
          planName: p.name,
          amountCents: m.amountCents,
          subscriptions: mine.length,
          excluded: m.excluded,
        };
      })
      .filter((p) => p.subscriptions > 0)
      .sort((a, b) => b.amountCents - a.amountCents);

    const t = trials[0];
    const ended = Number(t?.ended ?? 0);
    const converted = Number(t?.converted ?? 0);
    return {
      mrr: { currency: 'BRL', amountCents: total.amountCents, byPlan },
      weeks: weeks.map((w) => {
        const n = Number(newPaid.find((r) => sameDay(r.wk, w))?.n ?? 0);
        const c = Number(churned.find((r) => sameDay(r.wk, w))?.n ?? 0);
        return {
          weekStart: w.toISOString(),
          newPaid: n,
          churned: c,
          netNew: n - c,
        };
      }),
      trialToPaid: {
        trialsEnded: ended,
        converted,
        rate: ended > 0 ? converted / ended : null,
      },
      arppu: arppu.map((r) => {
        const users = Number(r.users);
        const revenue = Number(r.revenue);
        return {
          currency: r.currency,
          revenueCents: revenue,
          payingUsers: users,
          arppuCents: users > 0 ? Math.round(revenue / users) : 0,
        };
      }),
      refunds: refunds.map((r) => {
        const paid = Number(r.paid);
        const refunded = Number(r.refunded);
        return {
          currency: r.currency,
          paidCents: paid,
          refundedCents: refunded,
          payments: Number(r.n),
          refundedPayments: Number(r.nr),
          rate: paid > 0 ? refunded / paid : null,
        };
      }),
    };
  }

  // ─── Course funnels (ADMIN all, TEACHER own) ─────────────────────────

  async courseFunnels(
    actor: ApiUser,
    locale: string,
  ): Promise<{ items: CourseFunnelRow[] }> {
    const authorId = actor.role === 'TEACHER' ? actor.userId : null;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        slug: string;
        status: string;
        sourceLocale: string;
        lessons: bigint;
        enrolled: bigint;
        started: bigint;
        completed: bigint;
      }[]
    >`
      WITH live AS (
        SELECT l.id, m."courseId" FROM "Lesson" l
          JOIN "Module" m ON m.id = l."moduleId"
          WHERE l."deletedAt" IS NULL AND m."deletedAt" IS NULL
      ), lc AS (
        SELECT "courseId", COUNT(*) AS n FROM live GROUP BY 1
      ), up AS (
        SELECT live."courseId", p."userId", COUNT(*) AS done FROM "Progress" p
          JOIN live ON live.id = p."lessonId" GROUP BY 1, 2
      ), en AS (
        SELECT "courseId", "userId" FROM "Enrollment"
        UNION SELECT "courseId", "userId" FROM up
      )
      SELECT c.id, c.slug, c.status::text AS status, c."sourceLocale",
        COALESCE(lc.n, 0) AS lessons,
        (SELECT COUNT(*) FROM en WHERE en."courseId" = c.id) AS enrolled,
        (SELECT COUNT(*) FROM up WHERE up."courseId" = c.id) AS started,
        (SELECT COUNT(*) FROM up WHERE up."courseId" = c.id AND lc.n > 0
          AND up.done >= lc.n) AS completed
      FROM "Course" c LEFT JOIN lc ON lc."courseId" = c.id
      WHERE c."deletedAt" IS NULL
        AND (${authorId}::text IS NULL OR c."authorId" = ${authorId})
      ORDER BY enrolled DESC, c.slug ASC
      LIMIT 200`;
    const titles = await resolveTitles(
      this.prisma,
      'COURSE',
      new Map(rows.map((r) => [r.id, r.sourceLocale])),
      locale,
    );
    return {
      items: rows.map((r) => ({
        courseId: r.id,
        slug: r.slug,
        title: titles.get(r.id) ?? r.slug,
        status: r.status,
        lessons: Number(r.lessons),
        enrolled: Number(r.enrolled),
        started: Number(r.started),
        completed: Number(r.completed),
      })),
    };
  }

  async courseFunnel(
    actor: ApiUser,
    courseId: string,
    locale: string,
    now = new Date(),
  ): Promise<{ course: CourseFunnelRow; lessons: LessonFunnelRow[] }> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true, authorId: true, sourceLocale: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (actor.role === 'TEACHER' && course.authorId !== actor.userId)
      throw new ForbiddenException({
        code: 'NOT_COURSE_AUTHOR',
        message: 'Teachers can only see analytics for their own courses',
      });
    const all = await this.courseFunnels({ ...actor, role: 'ADMIN' }, locale);
    const summary = all.items.find((c) => c.courseId === courseId);
    if (!summary) throw new NotFoundException('Course not found');

    const since = new Date(now.getTime() - 90 * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        type: string;
        opened: bigint;
        completed: bigint;
      }[]
    >`
      SELECT l.id, l.type::text AS type,
        (SELECT COUNT(DISTINCT e."userId") FROM "AnalyticsEvent" e
          WHERE e.name = 'lesson_open' AND e.props->>'lessonId' = l.id
            AND e."userId" IS NOT NULL AND e."occurredAt" >= ${since}) AS opened,
        (SELECT COUNT(*) FROM "Progress" p WHERE p."lessonId" = l.id) AS completed
      FROM "Lesson" l JOIN "Module" m ON m.id = l."moduleId"
      WHERE m."courseId" = ${courseId}
        AND l."deletedAt" IS NULL AND m."deletedAt" IS NULL
      ORDER BY m."order" ASC, l."order" ASC`;
    const titles = await resolveTitles(
      this.prisma,
      'LESSON',
      new Map(rows.map((r) => [r.id, course.sourceLocale])),
      locale,
    );
    let prev: number | null = null;
    const lessons = rows.map((r, i) => {
      const completed = Number(r.completed);
      const dropOff = prev === null ? 0 : Math.max(0, prev - completed);
      const row: LessonFunnelRow = {
        lessonId: r.id,
        title: titles.get(r.id) ?? `#${i + 1}`,
        position: i + 1,
        type: r.type,
        opened: Number(r.opened),
        completed,
        dropOff,
        dropOffRate: prev === null ? null : prev > 0 ? dropOff / prev : 0,
      };
      prev = completed;
      return row;
    });
    return { course: summary, lessons };
  }
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The last REPORT_WEEKS UTC Mondays, oldest first (current week last). */
export function weekStarts(now: Date): Date[] {
  const current = currentWeekStart(now).getTime();
  return Array.from(
    { length: REPORT_WEEKS },
    (_, i) => new Date(current - (REPORT_WEEKS - 1 - i) * 7 * DAY_MS),
  );
}

function sameDay(a: Date, b: Date): boolean {
  return (
    new Date(a).toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
  );
}
