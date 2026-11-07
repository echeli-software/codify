import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BadgesService,
  evalRule,
  type BadgeRule,
  type UserMetrics,
} from '../gamification/badges.service.js';
import type { BadgeClauseResult, BadgeTestResponse } from './admin-ops.dto.js';

const PREDICATES = ['gte', 'lte', 'gt', 'lt', 'eq'] as const;

/**
 * Per-clause breakdown of a rule against a user's metrics. Each clause is
 * judged by the badge engine itself (`evalRule` on a one-clause rule), so
 * the result can never disagree with the real evaluator.
 */
export function explainRule(
  rule: unknown,
  metrics: UserMetrics,
): { mode: 'all' | 'any' | 'none'; clauses: BadgeClauseResult[] } {
  const r = (rule ?? {}) as BadgeRule;
  const mode = r.all ? 'all' : r.any ? 'any' : 'none';
  const list = (r.all ?? r.any ?? []) as unknown as Record<string, unknown>[];
  const clauses = list.map((c): BadgeClauseResult => {
    const isEvent = typeof c['event'] === 'string';
    const key = String(isEvent ? c['event'] : c['metric']);
    const source = (isEvent ? (c['count'] ?? { gte: 1 }) : c) as Record<
      string,
      unknown
    >;
    const predicate: Record<string, number> = {};
    for (const p of PREDICATES)
      if (typeof source[p] === 'number') predicate[p] = source[p] as number;
    return {
      kind: isEvent ? 'event' : 'metric',
      key,
      predicate,
      value: (isEvent ? metrics.events[key] : metrics.metrics[key]) ?? 0,
      passed: evalRule({ all: [c] } as unknown as BadgeRule, metrics),
    };
  });
  return { mode, clauses };
}

/**
 * POST /admin/badges/:id/test — would this badge unlock for this user
 * right now? Reads the same metrics the evaluator uses; awards nothing.
 */
@Injectable()
export class BadgeTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly badges: BadgesService,
  ) {}

  async test(badgeId: string, userId: string): Promise<BadgeTestResponse> {
    const [badge, user, earned] = await Promise.all([
      this.prisma.badge.findUnique({ where: { id: badgeId } }),
      this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.userBadge.findUnique({
        where: { userId_badgeId: { userId, badgeId } },
      }),
    ]);
    if (!badge) throw new NotFoundException('Badge not found');
    if (!user)
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    // computeMetrics only reads, so the root client stands in for a tx.
    const metrics = await this.badges.computeMetrics(
      this.prisma as unknown as Prisma.TransactionClient,
      userId,
    );
    const { mode, clauses } = explainRule(badge.rule, metrics);
    return {
      badgeId,
      userId,
      wouldUnlock: evalRule(badge.rule as unknown as BadgeRule, metrics),
      alreadyEarned: !!earned,
      awardedAt: earned?.awardedAt.toISOString() ?? null,
      badgeActive: badge.isActive,
      mode,
      clauses,
      events: metrics.events,
      metrics: metrics.metrics,
    };
  }
}
