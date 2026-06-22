import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  computeRollover,
  currentWeekStart,
  DEMOTE_COUNT,
  PROMOTE_COUNT,
  previousWeekStart,
} from '@codify/domain';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { LeagueAccumulatorService } from './league-accumulator.service.js';

const MAX_FREEZES = 2;
const WEEK_MS = 7 * 86_400_000;

export interface LeagueMemberView {
  userId: string;
  displayName: string;
  weeklyXp: number;
  level: number;
  rank: number;
  isMe: boolean;
}

export interface CurrentLeagueView {
  tier: string;
  weekStart: string;
  resetAt: string;
  promoteCount: number;
  demoteCount: number;
  cohortSize: number;
  myRank: number;
  myWeeklyXp: number;
  members: LeagueMemberView[];
}

@Injectable()
export class LeaguesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly accumulator: LeagueAccumulatorService,
  ) {}

  /** The caller's current-week cohort leaderboard (lazy-assigns them in). */
  async getCurrent(userId: string): Promise<CurrentLeagueView> {
    const weekStart = currentWeekStart();
    await this.prisma.$transaction((tx) => this.accumulator.ensureMembership(tx, userId));

    const membership = await this.prisma.leagueMembership.findFirst({
      where: { userId, league: { weekStart } },
      include: { league: true },
    });
    if (!membership) throw new NotFoundException('No league membership');

    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId: membership.leagueId },
      include: { user: { select: { id: true, displayName: true, totalXp: true } } },
      orderBy: [{ weeklyXp: 'desc' }, { userId: 'asc' }],
    });

    const members: LeagueMemberView[] = rows.map((r, i) => ({
      userId: r.userId,
      displayName: r.user.displayName,
      weeklyXp: r.weeklyXp,
      level: levelFromXp(r.user.totalXp),
      rank: i + 1,
      isMe: r.userId === userId,
    }));
    const me = members.find((m) => m.isMe);

    return {
      tier: membership.league.tier,
      weekStart: weekStart.toISOString(),
      resetAt: new Date(weekStart.getTime() + WEEK_MS).toISOString(),
      promoteCount: PROMOTE_COUNT,
      demoteCount: DEMOTE_COUNT,
      cohortSize: members.length,
      myRank: me?.rank ?? 0,
      myWeeklyXp: me?.weeklyXp ?? 0,
      members,
    };
  }

  /**
   * Roll over every cohort for a finished week: rank, mark promotion/demotion,
   * and grant rewards atomically. Idempotent — memberships already stamped
   * with `rewardedAt` are skipped, so re-running is safe.
   */
  async runRollover(weekStartInput?: string): Promise<{
    weekStart: string;
    leaguesProcessed: number;
    membersRewarded: number;
    promotions: number;
  }> {
    const weekStart = weekStartInput ? new Date(weekStartInput) : previousWeekStart();
    const leagues = await this.prisma.league.findMany({
      where: { weekStart },
      include: { members: true },
    });

    let rewarded = 0;
    let promotions = 0;

    for (const league of leagues) {
      const results = computeRollover(
        league.members.map((m) => ({ userId: m.userId, weeklyXp: m.weeklyXp })),
        league.tier,
      );
      await this.prisma.$transaction(async (tx) => {
        for (const r of results) {
          const member = league.members.find((m) => m.userId === r.userId);
          if (!member || member.rewardedAt) continue; // idempotent skip

          await tx.leagueMembership.update({
            where: { leagueId_userId: { leagueId: league.id, userId: r.userId } },
            data: { finalRank: r.rank, promoted: r.promoted, demoted: r.demoted, rewardedAt: new Date() },
          });

          if (r.rewardXp > 0 || r.rewardCoins > 0) {
            await this.gamification.grantReward(
              {
                userId: r.userId,
                baseXp: r.rewardXp,
                baseCoins: r.rewardCoins,
                xpSource: 'LEAGUE_PROMOTION',
                coinSource: 'WEEKLY_LEAGUE',
                refType: 'league',
                refId: league.id,
                idempotencyKey: `league:${league.id}:${r.userId}`,
                flat: true,
              },
              tx,
            );
          }
          if (r.rewardFreeze > 0) {
            await this.grantFreeze(tx, r.userId, r.rewardFreeze, weekStart);
          }
          if (r.promoted) promotions += 1;
          rewarded += 1;
        }
      });
    }

    return {
      weekStart: weekStart.toISOString(),
      leaguesProcessed: leagues.length,
      membersRewarded: rewarded,
      promotions,
    };
  }

  /** Bank a freeze (capped at MAX_FREEZES). */
  private async grantFreeze(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    fallbackDate: Date,
  ): Promise<void> {
    const streak = await tx.streak.findUnique({ where: { userId } });
    const freezes = Math.min(MAX_FREEZES, (streak?.freezesAvailable ?? 0) + amount);
    if (streak) {
      await tx.streak.update({ where: { userId }, data: { freezesAvailable: freezes } });
    } else {
      await tx.streak.create({
        data: { userId, currentDays: 0, longestDays: 0, freezesAvailable: freezes, lastActivityDate: fallbackDate },
      });
    }
  }
}
