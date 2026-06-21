import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from './gamification.service.js';

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
interface EventClause {
  event: string;
  count: NumericPredicate;
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

interface UserMetrics {
  events: Record<string, number>;
  metrics: Record<string, number>;
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
  ) {}

  // ─── CRUD (admin) ──────────────────────────────────────────────────────

  listBadges(includeInactive: boolean) {
    return this.prisma.badge.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { slug: 'asc' },
    });
  }

  async createBadge(input: BadgeInput) {
    const dupe = await this.prisma.badge.findUnique({ where: { slug: input.slug } });
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
    return this.prisma.badge.update({
      where: { id },
      data: {
        name: patch.name,
        description: patch.description,
        iconName: patch.iconName,
        rule: patch.rule ? (patch.rule as unknown as Prisma.InputJsonValue) : undefined,
        xpReward: patch.xpReward,
        coinReward: patch.coinReward,
        isHidden: patch.isHidden,
        isActive: patch.isActive,
      },
    });
  }

  async deleteBadge(id: string): Promise<void> {
    const target = await this.prisma.badge.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Badge not found');
    await this.prisma.badge.update({ where: { id }, data: { isActive: false } });
  }

  /** Badges for a user — earned ones + visible (non-hidden) unearned ones. */
  async listForUser(userId: string): Promise<BadgeView[]> {
    const [badges, earned] = await Promise.all([
      this.prisma.badge.findMany({ where: { isActive: true }, orderBy: { slug: 'asc' } }),
      this.prisma.userBadge.findMany({ where: { userId } }),
    ]);
    const earnedMap = new Map(earned.map((e) => [e.badgeId, e.awardedAt]));
    return badges
      .filter((b) => !b.isHidden || earnedMap.has(b.id))
      .map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
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
  async evaluate(tx: Tx, userId: string): Promise<UnlockedBadge[]> {
    const [badges, owned] = await Promise.all([
      tx.badge.findMany({ where: { isActive: true } }),
      tx.userBadge.findMany({ where: { userId }, select: { badgeId: true } }),
    ]);
    const ownedIds = new Set(owned.map((o) => o.badgeId));
    const candidates = badges.filter((b) => !ownedIds.has(b.id));
    if (candidates.length === 0) return [];

    const metrics = await this.computeMetrics(tx, userId);
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

  private async computeMetrics(tx: Tx, userId: string): Promise<UserMetrics> {
    const [lessonComplete, streak, categoryRows] = await Promise.all([
      tx.progress.count({ where: { userId } }),
      tx.streak.findUnique({ where: { userId }, select: { currentDays: true, longestDays: true } }),
      tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT cc."categoryId") AS count
        FROM "Progress" p
        JOIN "Lesson" l ON l.id = p."lessonId"
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "CourseCategory" cc ON cc."courseId" = m."courseId"
        WHERE p."userId" = ${userId}
      `,
    ]);
    const categoriesCompleted = Number(categoryRows[0]?.count ?? 0);
    return {
      events: { lesson_complete: lessonComplete, exercise_pass: 0, ai_prompt_pass: 0 },
      metrics: {
        'streak.current_days': streak?.currentDays ?? 0,
        'streak.longest_days': streak?.longestDays ?? 0,
        'categories.completed': categoriesCompleted,
      },
    };
  }
}

// ─── Pure rule evaluation ────────────────────────────────────────────────

function evalRule(rule: BadgeRule, m: UserMetrics): boolean {
  if (rule.all) return rule.all.every((c) => evalClause(c, m));
  if (rule.any) return rule.any.some((c) => evalClause(c, m));
  return false;
}

function evalClause(clause: Clause, m: UserMetrics): boolean {
  if ('event' in clause) {
    const value = m.events[clause.event] ?? 0;
    return cmp(value, clause.count);
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
