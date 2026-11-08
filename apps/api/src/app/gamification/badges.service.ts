import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from './gamification.service.js';
import {
  ContentLocalizer,
  changedFields,
} from '../translations/content-localizer.service.js';

type Tx = Prisma.TransactionClient;

export interface BadgeView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconName: string | null;
  earned: boolean;
  awardedAt: string | null;
}

export interface UnlockedBadge {
  id: string;
  slug: string;
  name: string;
  icon: string;
  description?: string;
}

export interface BadgeInput {
  slug: string;
  name: string;
  description?: string | null;
  iconName?: string | null;
  rule: BadgeRule;
  xpReward?: number;
  coinReward?: number;
  isHidden?: boolean;
  isActive?: boolean;
}

// ─── Rule DSL (docs/07 §7) ───────────────────────────────────────────────

type Predicate = NumericPredicate; // gte/lte/gt/lt/eq
interface NumericPredicate {
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  eq?: number;
}
/**
 * Event filters (docs/07 §7): `scorePct` (numeric predicate) on
 * ai_prompt_pass / quiz_pass / exercise_pass; `afterStreakLost: true` on
 * any lesson event ("completed a lesson after losing a streak").
 */
export interface EventWhere {
  scorePct?: NumericPredicate;
  afterStreakLost?: boolean;
}
interface EventClause {
  event: string;
  where?: EventWhere;
  count?: NumericPredicate;
}
interface MetricClause {
  metric: string;
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  eq?: number;
}
type Clause = EventClause | MetricClause;
export interface BadgeRule {
  all?: Clause[];
  any?: Clause[];
}

export interface UserMetrics {
  events: Record<string, number>;
  metrics: Record<string, number>;
  /** Counts for filtered event clauses, keyed by {@link whereKey}. */
  filtered?: Record<string, number>;
}

/** The event that triggered an evaluation (feeds `where` filters). */
export interface BadgeEventContext {
  type: string;
  lessonId?: string | null;
  scorePct?: number | null;
  /** This completion restarted a streak that had been lost. */
  afterStreakLost?: boolean;
}

/** Stable key of a filtered clause (event + where). */
export function whereKey(event: string, where: EventWhere): string {
  const w: Record<string, unknown> = {};
  for (const k of Object.keys(where).sort())
    w[k] = (where as Record<string, unknown>)[k];
  return `${event}|${JSON.stringify(w)}`;
}

/** Events a `scorePct` filter can apply to. */
export const SCORED_BADGE_EVENTS = [
  'ai_prompt_pass',
  'quiz_pass',
  'exercise_pass',
] as const;

function assertRule(rule: unknown): void {
  const errors = validateBadgeRule(rule);
  if (errors.length) throw new BadRequestException(errors);
}

/**
 * Badge management + evaluator. The evaluator runs after reward events,
 * inside the event transaction, awarding any newly-satisfied badges and
 * granting their flat rewards. The rule DSL supports `all`/`any` of event
 * counts and precomputed metrics with numeric predicates.
 */
@Injectable()
export class BadgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  // ─── CRUD (admin) ──────────────────────────────────────────────────────

  listBadges(includeInactive: boolean) {
    return this.prisma.badge.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { slug: 'asc' },
    });
  }

  async createBadge(input: BadgeInput) {
    assertRule(input.rule);
    const dupe = await this.prisma.badge.findUnique({
      where: { slug: input.slug },
    });
    if (dupe) throw new ConflictException('Slug already in use');
    return this.prisma.badge.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        iconName: input.iconName ?? null,
        rule: input.rule as unknown as Prisma.InputJsonValue,
        xpReward: input.xpReward ?? 0,
        coinReward: input.coinReward ?? 0,
        isHidden: input.isHidden ?? false,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateBadge(id: string, patch: Partial<BadgeInput>) {
    const target = await this.prisma.badge.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Badge not found');
    if (patch.rule !== undefined) assertRule(patch.rule);
    if (patch.slug !== undefined && patch.slug !== target.slug) {
      const dupe = await this.prisma.badge.findUnique({
        where: { slug: patch.slug },
      });
      if (dupe) throw new ConflictException('Slug already in use');
    }
    const updated = await this.prisma.badge.update({
      where: { id },
      data: {
        slug: patch.slug,
        name: patch.name,
        description: patch.description,
        iconName: patch.iconName,
        rule: patch.rule
          ? (patch.rule as unknown as Prisma.InputJsonValue)
          : undefined,
        xpReward: patch.xpReward,
        coinReward: patch.coinReward,
        isHidden: patch.isHidden,
        isActive: patch.isActive,
      },
    });
    // Source text changed → its translations need review (docs/11 §3).
    await this.localizer?.markSourceChanged(
      'BADGE',
      id,
      changedFields(target, patch, ['name', 'description']),
    );
    return updated;
  }

  async deleteBadge(id: string): Promise<void> {
    const target = await this.prisma.badge.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Badge not found');
    await this.prisma.badge.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** Badges for a user — earned ones + visible (non-hidden) unearned ones. */
  async listForUser(userId: string): Promise<BadgeView[]> {
    const [badges, earned] = await Promise.all([
      this.prisma.badge.findMany({
        where: { isActive: true },
        orderBy: { slug: 'asc' },
      }),
      this.prisma.userBadge.findMany({ where: { userId } }),
    ]);
    const earnedMap = new Map(earned.map((e) => [e.badgeId, e.awardedAt]));
    const visible = badges.filter((b) => !b.isHidden || earnedMap.has(b.id));
    // name / description in the caller's locale (docs/11 §3).
    const tr = await this.localizer?.localize([
      {
        entityType: 'BADGE',
        items: visible.map((b) => ({
          id: b.id,
          values: { name: b.name, description: b.description },
        })),
      },
    ]);
    return visible.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: tr?.text('BADGE', b.id, 'name', b.name) ?? b.name,
      description:
        tr?.text('BADGE', b.id, 'description', b.description) ?? b.description,
      iconName: b.iconName,
      earned: earnedMap.has(b.id),
      awardedAt: earnedMap.get(b.id)?.toISOString() ?? null,
    }));
  }

  // ─── Evaluator ─────────────────────────────────────────────────────────

  /**
   * Award any active badges the user newly qualifies for. Runs in the event
   * transaction; returns the badges unlocked so the client can celebrate.
   */
  async evaluate(
    tx: Tx,
    userId: string,
    ctx: BadgeEventContext | null = null,
  ): Promise<UnlockedBadge[]> {
    const [badges, owned] = await Promise.all([
      tx.badge.findMany({ where: { isActive: true } }),
      tx.userBadge.findMany({ where: { userId }, select: { badgeId: true } }),
    ]);
    const ownedIds = new Set(owned.map((o) => o.badgeId));
    const candidates = badges.filter((b) => !ownedIds.has(b.id));
    if (candidates.length === 0) return [];

    const metrics = await this.computeMetrics(tx, userId);
    metrics.filtered = await this.computeFiltered(
      tx,
      userId,
      candidates.map((b) => b.rule as unknown as BadgeRule),
      metrics,
      ctx,
    );
    const unlocked: UnlockedBadge[] = [];

    for (const badge of candidates) {
      const rule = badge.rule as unknown as BadgeRule;
      if (!evalRule(rule, metrics)) continue;
      await tx.userBadge.create({ data: { userId, badgeId: badge.id } });
      if (badge.xpReward > 0 || badge.coinReward > 0) {
        await this.gamification.grantReward(
          {
            userId,
            baseXp: badge.xpReward,
            baseCoins: badge.coinReward,
            xpSource: 'BADGE_UNLOCK',
            coinSource: 'BADGE_UNLOCK',
            refType: 'badge',
            refId: badge.id,
            idempotencyKey: `badge:${userId}:${badge.id}`,
            flat: true,
          },
          tx,
        );
      }
      unlocked.push({
        id: badge.id,
        slug: badge.slug,
        name: badge.name,
        icon: badge.iconName ?? 'trophy',
        description: badge.description ?? undefined,
      });
    }
    return unlocked;
  }

  /**
   * Counts for every filtered event clause in `rules` (computed only when a
   * candidate badge uses one):
   *   - `scorePct` — distinct items passed with a matching score, from
   *     AiSubmission / QuizAttempt / scored Submission rows;
   *   - `afterStreakLost` — 1 when this event restarted a lost streak, or
   *     the stored streak shows a loss followed by activity (longest >
   *     current ≥ 1); otherwise 0. It answers "happened at least once", so
   *     validation only allows it with `count` ≤ 1.
   */
  async computeFiltered(
    tx: Tx,
    userId: string,
    rules: BadgeRule[],
    metrics: UserMetrics,
    ctx: BadgeEventContext | null,
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const rule of rules) {
      for (const c of [...(rule.all ?? []), ...(rule.any ?? [])]) {
        if (!('event' in c) || !c.where) continue;
        const key = whereKey(c.event, c.where);
        if (key in out) continue;
        out[key] = await this.countFiltered(
          tx,
          userId,
          c.event,
          c.where,
          metrics,
          ctx,
        );
      }
    }
    return out;
  }

  private async countFiltered(
    tx: Tx,
    userId: string,
    event: string,
    where: EventWhere,
    metrics: UserMetrics,
    ctx: BadgeEventContext | null,
  ): Promise<number> {
    let count = metrics.events[event] ?? 0;
    if (where.afterStreakLost) {
      const restarted =
        (ctx?.afterStreakLost ?? false) ||
        ((metrics.metrics['streak.longest_days'] ?? 0) >
          (metrics.metrics['streak.current_days'] ?? 0) &&
          (metrics.metrics['streak.current_days'] ?? 0) >= 1);
      count = restarted && count > 0 ? 1 : 0;
    }
    if (where.scorePct && count > 0) {
      const pred = predicateSql('"scorePct"', where.scorePct);
      let rows: { count: bigint }[] = [];
      if (event === 'ai_prompt_pass') {
        rows = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT "aiPromptId") AS count FROM "AiSubmission"
          WHERE "userId" = ${userId} AND passed ${pred}`;
      } else if (event === 'quiz_pass') {
        rows = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT "lessonId") AS count FROM "QuizAttempt"
          WHERE "userId" = ${userId} AND passed ${pred}`;
      } else if (event === 'exercise_pass') {
        rows = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT "exerciseId") AS count FROM "Submission"
          WHERE "userId" = ${userId} AND scored AND verdict = 'PASS' ${pred}`;
      }
      count = Math.min(count, Number(rows[0]?.count ?? 0));
    }
    return count;
  }

  /**
   * Event counts + metrics for the rule DSL, from the journals:
   *   lesson_complete   — Progress rows
   *   exercise_pass     — distinct exercises with a scored PASS submission
   *   ai_prompt_pass    — distinct AI prompts with a passing submission
   *   scenario_complete — distinct scenarios with a completed run
   *   quiz_pass         — completed QUIZ lessons (a quiz completes on pass)
   *   capstone_pass     — completed CAPSTONE lessons (the capstone_pass quest event)
   * plus metric certificates.capstone — capstone-course certificates earned
   * Each pass counts once per item, so retakes can't farm badges.
   */
  async computeMetrics(tx: Tx, userId: string): Promise<UserMetrics> {
    const [lessonComplete, streak, categoryRows, eventRows] = await Promise.all(
      [
        tx.progress.count({ where: { userId } }),
        tx.streak.findUnique({
          where: { userId },
          select: { currentDays: true, longestDays: true },
        }),
        tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT cc."categoryId") AS count
        FROM "Progress" p
        JOIN "Lesson" l ON l.id = p."lessonId"
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "CourseCategory" cc ON cc."courseId" = m."courseId"
        WHERE p."userId" = ${userId}
      `,
        tx.$queryRaw<EventCountRow[]>`
        SELECT
          (SELECT COUNT(DISTINCT s."exerciseId") FROM "Submission" s
            WHERE s."userId" = ${userId} AND s.scored AND s.verdict = 'PASS') AS "exercisePass",
          (SELECT COUNT(DISTINCT a."aiPromptId") FROM "AiSubmission" a
            WHERE a."userId" = ${userId} AND a.passed) AS "aiPromptPass",
          (SELECT COUNT(DISTINCT r."scenarioId") FROM "ScenarioRun" r
            WHERE r."userId" = ${userId} AND r.completed) AS "scenarioComplete",
          (SELECT COUNT(*) FROM "Progress" p JOIN "Lesson" l ON l.id = p."lessonId"
            WHERE p."userId" = ${userId} AND l.type::text = 'QUIZ') AS "quizPass",
          (SELECT COUNT(*) FROM "Progress" p JOIN "Lesson" l ON l.id = p."lessonId"
            WHERE p."userId" = ${userId} AND l.type::text = 'CAPSTONE') AS "capstoneLessons",
          (SELECT COUNT(*) FROM "Certificate" c
            WHERE c."userId" = ${userId} AND c."isCapstone") AS "capstoneCerts"
      `,
      ],
    );
    const categoriesCompleted = Number(categoryRows[0]?.count ?? 0);
    const e = eventRows[0];
    const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
    return {
      events: {
        lesson_complete: lessonComplete,
        exercise_pass: n(e?.exercisePass),
        ai_prompt_pass: n(e?.aiPromptPass),
        scenario_complete: n(e?.scenarioComplete),
        quiz_pass: n(e?.quizPass),
        capstone_pass: n(e?.capstoneLessons),
      },
      metrics: {
        'streak.current_days': streak?.currentDays ?? 0,
        'streak.longest_days': streak?.longestDays ?? 0,
        'categories.completed': categoriesCompleted,
        'lessons.completed': lessonComplete,
        'certificates.capstone': n(e?.capstoneCerts),
      },
    };
  }
}

interface EventCountRow {
  exercisePass: bigint;
  aiPromptPass: bigint;
  scenarioComplete: bigint;
  quizPass: bigint;
  capstoneLessons: bigint;
  capstoneCerts: bigint;
}

/** Event names the evaluator can count (docs/07 §7 + capstones). */
export const BADGE_EVENTS = [
  'lesson_complete',
  'exercise_pass',
  'ai_prompt_pass',
  'scenario_complete',
  'quiz_pass',
  'capstone_pass',
] as const;

/** Metrics the evaluator can read. */
export const BADGE_METRICS = [
  'streak.current_days',
  'streak.longest_days',
  'categories.completed',
  'lessons.completed',
  'certificates.capstone',
] as const;

/**
 * Structural validation of a badge rule (admin create/edit) so a typo can't
 * silently produce a badge nobody can ever earn. Returns problems; empty =
 * valid. An empty `any: []` is allowed (manually-awarded badges).
 */
export function validateBadgeRule(rule: unknown): string[] {
  const errors: string[] = [];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule))
    return ['rule must be an object'];
  const r = rule as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== 1 || !['all', 'any'].includes(keys[0]))
    return ['rule must have exactly one of "all" or "any"'];
  const clauses = r[keys[0]];
  if (!Array.isArray(clauses)) return [`"${keys[0]}" must be an array`];
  if (keys[0] === 'all' && clauses.length === 0)
    errors.push('"all" needs at least one clause');
  const preds = ['gte', 'lte', 'gt', 'lt', 'eq'];
  const checkPred = (p: Record<string, unknown>, where: string) => {
    const ks = Object.keys(p).filter((k) => preds.includes(k));
    if (ks.length === 0)
      errors.push(`${where}: needs a predicate (${preds.join('/')})`);
    for (const k of ks)
      if (typeof p[k] !== 'number' || !Number.isFinite(p[k] as number))
        errors.push(`${where}.${k} must be a number`);
  };
  clauses.forEach((c: unknown, i: number) => {
    const where = `${keys[0]}[${i}]`;
    if (!c || typeof c !== 'object')
      return errors.push(`${where} must be an object`);
    const clause = c as Record<string, unknown>;
    if ('where' in clause && !('event' in clause)) {
      errors.push(`${where}.where is only allowed on "event" clauses`);
    }
    if ('event' in clause) {
      const event = clause['event'] as string;
      if (!(BADGE_EVENTS as readonly string[]).includes(event))
        errors.push(`${where}.event must be one of ${BADGE_EVENTS.join(', ')}`);
      const count = clause['count'] ?? { gte: 1 };
      if (!count || typeof count !== 'object')
        errors.push(`${where}.count must be an object`);
      else checkPred(count as Record<string, unknown>, `${where}.count`);
      if ('where' in clause)
        validateWhere(
          clause['where'],
          event,
          count,
          `${where}.where`,
          errors,
          checkPred,
        );
    } else if ('metric' in clause) {
      if (
        !(BADGE_METRICS as readonly string[]).includes(
          clause['metric'] as string,
        )
      )
        errors.push(
          `${where}.metric must be one of ${BADGE_METRICS.join(', ')}`,
        );
      checkPred(clause, where);
    } else {
      errors.push(`${where} needs "event" or "metric"`);
    }
    return undefined;
  });
  return errors;
}

function validateWhere(
  w: unknown,
  event: string,
  count: unknown,
  path: string,
  errors: string[],
  checkPred: (p: Record<string, unknown>, where: string) => void,
): void {
  if (!w || typeof w !== 'object' || Array.isArray(w)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const o = w as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 0) errors.push(`${path} needs at least one filter`);
  for (const k of keys) {
    if (k === 'scorePct') {
      if (!(SCORED_BADGE_EVENTS as readonly string[]).includes(event))
        errors.push(
          `${path}.scorePct only applies to ${SCORED_BADGE_EVENTS.join(', ')}`,
        );
      const p = o[k];
      if (!p || typeof p !== 'object' || Array.isArray(p))
        errors.push(`${path}.scorePct must be a predicate object`);
      else checkPred(p as Record<string, unknown>, `${path}.scorePct`);
    } else if (k === 'afterStreakLost') {
      if (o[k] !== true) errors.push(`${path}.afterStreakLost must be true`);
      const c = (count ?? {}) as Record<string, unknown>;
      const needsMore =
        (typeof c['gte'] === 'number' && c['gte'] > 1) ||
        (typeof c['gt'] === 'number' && c['gt'] >= 1) ||
        (typeof c['eq'] === 'number' && c['eq'] > 1);
      if (needsMore)
        errors.push(
          `${path}.afterStreakLost can only be counted once (count ≤ 1)`,
        );
    } else {
      errors.push(
        `${path}.${k} is not a supported filter (scorePct, afterStreakLost)`,
      );
    }
  }
}

const SQL_OPS: Record<string, string> = {
  gte: '>=',
  lte: '<=',
  gt: '>',
  lt: '<',
  eq: '=',
};

/** `AND col >= $n …` for a validated numeric predicate (values bound). */
function predicateSql(column: string, p: NumericPredicate): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [op, sym] of Object.entries(SQL_OPS)) {
    const v = (p as Record<string, unknown>)[op];
    if (typeof v === 'number' && Number.isFinite(v))
      parts.push(Prisma.sql`AND ${Prisma.raw(column)} ${Prisma.raw(sym)} ${v}`);
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

// ─── Pure rule evaluation ────────────────────────────────────────────────

function evalRule(rule: BadgeRule, m: UserMetrics): boolean {
  if (rule.all) return rule.all.every((c) => evalClause(c, m));
  if (rule.any) return rule.any.some((c) => evalClause(c, m));
  return false;
}

function evalClause(clause: Clause, m: UserMetrics): boolean {
  if ('event' in clause) {
    const value = clause.where
      ? (m.filtered?.[whereKey(clause.event, clause.where)] ?? 0)
      : (m.events[clause.event] ?? 0);
    // No count → "happened at least once" (docs/07 §7 "Comeback" example).
    return cmp(value, clause.count ?? { gte: 1 });
  }
  const value = m.metrics[clause.metric] ?? 0;
  return cmp(value, clause);
}

function cmp(value: number, p: Predicate): boolean {
  if (p.gte !== undefined && !(value >= p.gte)) return false;
  if (p.lte !== undefined && !(value <= p.lte)) return false;
  if (p.gt !== undefined && !(value > p.gt)) return false;
  if (p.lt !== undefined && !(value < p.lt)) return false;
  if (p.eq !== undefined && !(value === p.eq)) return false;
  return true;
}

export { evalRule };
