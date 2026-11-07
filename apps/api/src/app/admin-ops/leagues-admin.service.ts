import { Injectable, NotFoundException } from '@nestjs/common';
import {
  COHORT_CAPACITY,
  DEMOTE_COUNT,
  MIN_COHORT_FOR_DEMOTION,
  PROMOTE_COUNT,
  TIER_ORDER,
  computeRollover,
  currentWeekStart,
  demoteZoneSize,
  promoteZoneSize,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import type {
  LeagueDetailResponse,
  LeagueSnapshotResponse,
  LeagueTierName,
  LeagueTierSnapshot,
} from './admin-ops.dto.js';

/** Nearest-rank percentile of an ascending list (0 for an empty list). */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

/**
 * Leagues admin (docs/04 "Gamification → Leagues"): this week's snapshot
 * per tier and a drill-in per league. Promotion/relegation zone sizes are
 * the @codify/domain constants the rollover uses; the reward amounts are
 * the `league.*` GamificationConfig keys (edited on the Gamification page).
 */
@Injectable()
export class LeaguesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GamificationConfigService,
  ) {}

  async snapshot(at?: string): Promise<LeagueSnapshotResponse> {
    const weekStart = currentWeekStart(at ? new Date(at) : new Date());
    const [leagues, rewards] = await Promise.all([
      this.prisma.league.findMany({
        where: { weekStart },
        select: {
          id: true,
          tier: true,
          cohortKey: true,
          members: { select: { weeklyXp: true } },
        },
        orderBy: [{ tier: 'asc' }, { cohortKey: 'asc' }],
      }),
      this.config.getMany(['league.promotionReward', 'league.rank1Reward']),
    ]);
    const tiers: LeagueTierSnapshot[] = TIER_ORDER.map((tier) => {
      const inTier = leagues.filter((l) => l.tier === tier);
      const xp = inTier
        .flatMap((l) => l.members.map((m) => m.weeklyXp))
        .sort((a, b) => a - b);
      return {
        tier,
        leagues: inTier.length,
        members: xp.length,
        p50WeeklyXp: percentile(xp, 50),
        p95WeeklyXp: percentile(xp, 95),
      };
    });
    const order = (t: string) => TIER_ORDER.indexOf(t as LeagueTierName);
    return {
      weekStart: weekStart.toISOString(),
      tiers,
      leagues: leagues
        .map((l) => ({
          id: l.id,
          tier: l.tier,
          cohortKey: l.cohortKey,
          members: l.members.length,
          topWeeklyXp: Math.max(0, ...l.members.map((m) => m.weeklyXp)),
        }))
        .sort(
          (a, b) =>
            order(a.tier) - order(b.tier) ||
            a.cohortKey.localeCompare(b.cohortKey),
        ),
      rules: {
        cohortCapacity: COHORT_CAPACITY,
        promoteCount: PROMOTE_COUNT,
        demoteCount: DEMOTE_COUNT,
        minCohortForDemotion: MIN_COHORT_FOR_DEMOTION,
        promotionReward: rewards['league.promotionReward'],
        rank1Reward: rewards['league.rank1Reward'],
      },
    };
  }

  /**
   * Members ranked as the rollover would rank them (weekly XP, ties by
   * user id), with the projected zone. Past weeks also carry the stored
   * final rank and promotion/demotion outcome.
   */
  async detail(id: string): Promise<LeagueDetailResponse> {
    const league = await this.prisma.league.findUnique({
      where: { id },
      select: {
        id: true,
        tier: true,
        weekStart: true,
        cohortKey: true,
        members: {
          select: {
            userId: true,
            weeklyXp: true,
            finalRank: true,
            promoted: true,
            demoted: true,
            user: { select: { displayName: true } },
          },
        },
      },
    });
    if (!league) throw new NotFoundException('League not found');
    const projected = computeRollover(
      league.members.map((m) => ({ userId: m.userId, weeklyXp: m.weeklyXp })),
      league.tier,
    );
    const byUser = new Map(league.members.map((m) => [m.userId, m]));
    const n = league.members.length;
    return {
      id: league.id,
      tier: league.tier,
      weekStart: league.weekStart.toISOString(),
      cohortKey: league.cohortKey,
      promoteZone: promoteZoneSize(n, league.tier),
      demoteZone: demoteZoneSize(n, league.tier),
      members: projected.map((r) => {
        const m = byUser.get(r.userId);
        return {
          rank: r.rank,
          userId: r.userId,
          displayName: m?.user.displayName ?? '',
          weeklyXp: m?.weeklyXp ?? 0,
          zone: r.promoted ? 'promote' : r.demoted ? 'demote' : 'stay',
          finalRank: m?.finalRank ?? null,
          promoted: m?.promoted ?? null,
          demoted: m?.demoted ?? null,
        };
      }),
    };
  }
}
