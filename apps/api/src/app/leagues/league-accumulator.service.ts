import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LeagueTier, Prisma } from '@prisma/client';
import {
  COHORT_CAPACITY,
  currentWeekStart,
  nextTierAfter,
} from '@codify/domain';

type Tx = Prisma.TransactionClient;

/**
 * Places users into weekly league cohorts and accumulates their weekly XP.
 * Kept free of any gamification dependency so `GamificationService.grantReward`
 * can call it on the hot path without a circular module reference.
 */
@Injectable()
export class LeagueAccumulatorService {
  /** Add `xp` to the user's current-week league standing (lazy-assigns). */
  async accumulateXp(tx: Tx, userId: string, xp: number): Promise<void> {
    if (xp <= 0) return;
    const membership = await this.ensureMembership(tx, userId);
    await tx.leagueMembership.update({
      where: { leagueId_userId: { leagueId: membership.leagueId, userId } },
      data: { weeklyXp: { increment: xp } },
    });
  }

  /**
   * Ensure the user has a membership for the current week, assigning them to a
   * cohort at their current tier (filling cohorts to {@link COHORT_CAPACITY}
   * before opening a new one). Returns the membership.
   */
  async ensureMembership(
    tx: Tx,
    userId: string,
  ): Promise<{ leagueId: string }> {
    const weekStart = currentWeekStart();
    const existing = await tx.leagueMembership.findFirst({
      where: { userId, league: { weekStart } },
      select: { leagueId: true },
    });
    if (existing) return existing;

    const tier = await this.resolveTier(tx, userId, weekStart);
    const league = await this.findOrCreateCohort(tx, tier, weekStart);
    await tx.leagueMembership.create({
      data: { leagueId: league.id, userId, weeklyXp: 0 },
    });
    return { leagueId: league.id };
  }

  /** Tier carried over from the user's most recent prior week (Bronze default). */
  private async resolveTier(
    tx: Tx,
    userId: string,
    weekStart: Date,
  ): Promise<LeagueTier> {
    const prev = await tx.leagueMembership.findFirst({
      where: { userId, league: { weekStart: { lt: weekStart } } },
      orderBy: { league: { weekStart: 'desc' } },
      include: { league: { select: { tier: true } } },
    });
    if (!prev) return 'BRONZE';
    return nextTierAfter(
      prev.league.tier,
      prev.promoted ?? false,
      prev.demoted ?? false,
    );
  }

  private async findOrCreateCohort(tx: Tx, tier: LeagueTier, weekStart: Date) {
    const leagues = await tx.league.findMany({
      where: { tier, weekStart },
      include: { _count: { select: { members: true } } },
    });
    const open = leagues.find((l) => l._count.members < COHORT_CAPACITY);
    if (open) return open;
    return tx.league.create({
      data: { tier, weekStart, cohortKey: randomUUID().slice(0, 8) },
    });
  }
}
