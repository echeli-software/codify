import { Cron } from '@nestjs/schedule';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { LeagueTier, Prisma } from '@prisma/client';
import {
  computeRollover,
  currentWeekStart,
  demoteZoneSize,
  nextTierAfter,
  previousWeekStart,
  promoteZoneSize,
  type RollResult,
} from '@codify/domain';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import { UserPushService } from '../gamification/user-push.service.js';
import { jobsEnabled, ENGAGEMENT_CRONS } from '../gamification/jobs.js';
import { LeagueAccumulatorService } from './league-accumulator.service.js';

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

export interface LastWeekResultView {
  tier: LeagueTier;
  newTier: LeagueTier;
  finalRank: number;
  cohortSize: number;
  promoted: boolean;
  demoted: boolean;
  xpReward: number;
  coinReward: number;
  freezeAwarded: boolean;
  weekStart: string;
}

export interface RolloverSummary {
  weekStart: string;
  leaguesProcessed: number;
  membersRewarded: number;
  promotions: number;
  badgesAwarded: number;
  pushesSent: number;
}

/** Idempotency key of a member's rollover reward (XP side; coins add :coin). */
export function leagueRewardKey(leagueId: string, userId: string): string {
  return `league:${leagueId}:${userId}`;
}

/** Monthly-rotating weekly-winner badge (docs/07 §9 "rotates monthly"). */
export function weeklyBadgeSlug(weekStart: Date): string {
  const y = weekStart.getUTCFullYear();
  const m = String(weekStart.getUTCMonth() + 1).padStart(2, '0');
  return `league-champion-${y}-${m}`;
}

@Injectable()
export class LeaguesService {
  private readonly logger = new Logger(LeaguesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly accumulator: LeagueAccumulatorService,
    private readonly config: GamificationConfigService,
    private readonly push: UserPushService,
  ) {}

  /** The caller's current-week cohort leaderboard (lazy-assigns them in). */
  async getCurrent(userId: string): Promise<CurrentLeagueView> {
    const weekStart = currentWeekStart();
    await this.prisma.$transaction((tx) =>
      this.accumulator.ensureMembership(tx, userId),
    );

    const membership = await this.prisma.leagueMembership.findFirst({
      where: { userId, league: { weekStart } },
      include: { league: true },
    });
    if (!membership) throw new NotFoundException('No league membership');

    const rows = await this.prisma.leagueMembership.findMany({
      where: { leagueId: membership.leagueId },
      include: {
        user: { select: { id: true, displayName: true, totalXp: true } },
      },
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
    const tier = membership.league.tier;

    return {
      tier,
      weekStart: weekStart.toISOString(),
      resetAt: new Date(weekStart.getTime() + WEEK_MS).toISOString(),
      // Zones scale with the cohort (see @codify/domain promoteZoneSize).
      promoteCount: promoteZoneSize(members.length, tier),
      demoteCount: demoteZoneSize(members.length, tier),
      cohortSize: members.length,
      myRank: me?.rank ?? 0,
      myWeeklyXp: me?.weeklyXp ?? 0,
      members,
    };
  }

  /**
   * The caller's result for the most recent rolled-over week, or 404 when
   * they had no cohort last week or the rollover hasn't run yet.
   */
  async getLastWeek(
    userId: string,
    now: Date = new Date(),
  ): Promise<LastWeekResultView> {
    const weekStart = previousWeekStart(now);
    const m = await this.prisma.leagueMembership.findFirst({
      where: { userId, league: { weekStart }, rewardedAt: { not: null } },
      include: {
        league: { include: { _count: { select: { members: true } } } },
      },
    });
    if (!m) throw new NotFoundException('No league result for last week');

    const key = leagueRewardKey(m.leagueId, userId);
    const [xp, coin, promo] = await Promise.all([
      this.prisma.xpEvent.findUnique({
        where: { idempotencyKey: key },
        select: { amount: true },
      }),
      this.prisma.coinTransaction.findUnique({
        where: { idempotencyKey: `${key}:coin` },
        select: { delta: true },
      }),
      this.config.get('league.promotionReward'),
    ]);
    const promoted = m.promoted ?? false;
    const demoted = m.demoted ?? false;
    return {
      tier: m.league.tier,
      newTier: nextTierAfter(m.league.tier, promoted, demoted),
      finalRank: m.finalRank ?? 0,
      cohortSize: m.league._count.members,
      promoted,
      demoted,
      xpReward: xp?.amount ?? 0,
      coinReward: coin?.delta ?? 0,
      freezeAwarded: promoted && promo.freeze > 0,
      weekStart: weekStart.toISOString(),
    };
  }

  /**
   * Scheduled weekly rollover (docs/07 §9: Monday 00:05 UTC, for the week
   * that just ended). Idempotent — safe to re-run, and safe if several API
   * replicas fire it (each member is stamped in the same tx as its reward).
   *
   */
  @Cron(ENGAGEMENT_CRONS.leagueRollover, {
    name: 'runScheduledRollover',
    timeZone: 'UTC',
  })
  async runScheduledRollover(
    now: Date = new Date(),
  ): Promise<RolloverSummary | null> {
    if (!jobsEnabled()) return null;
    try {
      const res = await this.runRollover(previousWeekStart(now).toISOString());
      this.logger.log(
        `league rollover ${res.weekStart}: ${res.leaguesProcessed} cohorts, ` +
          `${res.membersRewarded} members, ${res.promotions} promotions`,
      );
      return res;
    } catch (err) {
      this.logger.error(`league rollover failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Roll over every cohort for a finished week: rank, mark promotion/demotion,
   * grant rewards and the weekly winner badge atomically per cohort, then
   * push each newly-processed member their result. Idempotent — memberships
   * already stamped with `rewardedAt` are skipped, so re-running is safe.
   */
  async runRollover(weekStartInput?: string): Promise<RolloverSummary> {
    const weekStart = weekStartInput
      ? new Date(weekStartInput)
      : previousWeekStart();
    const leagues = await this.prisma.league.findMany({
      where: { weekStart },
      include: { members: true },
    });
    const rewards = await this.config.getMany([
      'league.promotionReward',
      'league.rank1Reward',
      'streak.freezeCap',
    ]);
    const badgeId =
      leagues.length > 0 ? await this.ensureWeeklyBadge(weekStart) : null;

    let rewarded = 0;
    let promotions = 0;
    let badgesAwarded = 0;
    let pushesSent = 0;

    for (const league of leagues) {
      const results = computeRollover(
        league.members.map((m) => ({ userId: m.userId, weeklyXp: m.weeklyXp })),
        league.tier,
        {
          promotion: rewards['league.promotionReward'],
          rank1: rewards['league.rank1Reward'],
        },
      );
      const processed: RollResult[] = [];
      await this.prisma.$transaction(async (tx) => {
        for (const r of results) {
          // Conditional stamp: only the run that flips rewardedAt from null
          // pays out, so concurrent rollovers can't double-reward.
          const stamped = await tx.leagueMembership.updateMany({
            where: { leagueId: league.id, userId: r.userId, rewardedAt: null },
            data: {
              finalRank: r.rank,
              promoted: r.promoted,
              demoted: r.demoted,
              rewardedAt: new Date(),
            },
          });
          if (stamped.count === 0) continue; // idempotent skip

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
                idempotencyKey: leagueRewardKey(league.id, r.userId),
                flat: true,
              },
              tx,
            );
          }
          if (r.rewardFreeze > 0) {
            await this.grantFreeze(
              tx,
              r.userId,
              r.rewardFreeze,
              rewards['streak.freezeCap'],
              weekStart,
            );
          }
          if (r.awardWeeklyBadge && badgeId) {
            const res = await tx.userBadge.createMany({
              data: [{ userId: r.userId, badgeId }],
              skipDuplicates: true,
            });
            badgesAwarded += res.count;
          }
          if (r.promoted) promotions += 1;
          rewarded += 1;
          processed.push(r);
        }
      });

      // Pushes after commit — a push failure never rolls back rewards.
      for (const r of processed) {
        const res = await this.push.sendToUser(r.userId, ({ locale }) =>
          leagueResultCopy(locale, league.tier, r),
        );
        pushesSent += res.sent;
      }
    }

    return {
      weekStart: weekStart.toISOString(),
      leaguesProcessed: leagues.length,
      membersRewarded: rewarded,
      promotions,
      badgesAwarded,
      pushesSent,
    };
  }

  /**
   * This month's champion badge (docs/07 §9 "rotates monthly"), created on
   * first use outside any cohort transaction. Its rule never matches, so the
   * badge evaluator never awards it — only the rollover does.
   */
  private async ensureWeeklyBadge(weekStart: Date): Promise<string> {
    const slug = weeklyBadgeSlug(weekStart);
    const existing = await this.prisma.badge.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) return existing.id;
    const month = weekStart.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    try {
      const created = await this.prisma.badge.create({
        data: {
          slug,
          name: `League Champion · ${month}`,
          description: 'Finished #1 in a weekly league cohort.',
          iconName: 'trophy',
          rule: { any: [] },
          // Hidden until earned so a new badge every month doesn't pile up
          // as "locked" in everyone's collection.
          isHidden: true,
        },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent rollover created it first.
      const again = await this.prisma.badge.findUniqueOrThrow({
        where: { slug },
        select: { id: true },
      });
      return again.id;
    }
  }

  /** Bank a freeze (capped at `streak.freezeCap`). */
  private async grantFreeze(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    cap: number,
    fallbackDate: Date,
  ): Promise<void> {
    const streak = await tx.streak.findUnique({ where: { userId } });
    const freezes = Math.min(cap, (streak?.freezesAvailable ?? 0) + amount);
    if (streak) {
      await tx.streak.update({
        where: { userId },
        data: { freezesAvailable: freezes },
      });
    } else {
      await tx.streak.create({
        data: {
          userId,
          currentDays: 0,
          longestDays: 0,
          freezesAvailable: freezes,
          lastActivityDate: fallbackDate,
        },
      });
    }
  }
}

const TIER_NAMES: Record<LeagueTier, { pt: string; en: string }> = {
  BRONZE: { pt: 'Bronze', en: 'Bronze' },
  SILVER: { pt: 'Prata', en: 'Silver' },
  GOLD: { pt: 'Ouro', en: 'Gold' },
  PLATINUM: { pt: 'Platina', en: 'Platinum' },
  DIAMOND: { pt: 'Diamante', en: 'Diamond' },
};

/** LEAGUE_RESULT push copy (pt-BR / en-US). */
export function leagueResultCopy(
  locale: string,
  tier: LeagueTier,
  r: Pick<RollResult, 'rank' | 'promoted' | 'demoted' | 'newTier'>,
): {
  kind: 'LEAGUE_RESULT';
  title: string;
  body: string;
  data: Record<string, string>;
} {
  const pt = locale.startsWith('pt');
  const name = TIER_NAMES[r.newTier as LeagueTier][pt ? 'pt' : 'en'];
  let title: string;
  let body: string;
  if (r.promoted) {
    title = pt
      ? `🏆 Você subiu para a liga ${name}!`
      : `🏆 You've been promoted to ${name}!`;
    body = pt
      ? `Você terminou em #${r.rank} na semana. Bora pra próxima!`
      : `You finished #${r.rank} last week. Keep it going!`;
  } else if (r.demoted) {
    title = pt
      ? `Nova semana na liga ${name}`
      : `A fresh week in the ${name} league`;
    body = pt
      ? `Você terminou em #${r.rank}. Uma lição por dia já faz diferença.`
      : `You finished #${r.rank}. A lesson a day makes the difference.`;
  } else {
    title = pt
      ? `Você se manteve na liga ${name}`
      : `You held your spot in ${name}`;
    body = pt
      ? `Você terminou em #${r.rank} na semana.`
      : `You finished #${r.rank} last week.`;
  }
  return {
    kind: 'LEAGUE_RESULT',
    title,
    body,
    data: { tier, newTier: r.newTier, rank: String(r.rank), route: '/league' },
  };
}
