import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type CoinSource } from '@prisma/client';
import {
  advanceStreak as advanceStreakRule,
  applyMultiplier,
  currentWeekStart,
  effectiveStreak,
  localDateKey,
  localDayStart,
  resolveMultiplier,
  splitCoinsByCap,
  type MultiplierRule,
  type StreakState,
} from '@codify/domain';
import { levelFromXp, xpForLevel } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import { LeagueAccumulatorService } from '../leagues/league-accumulator.service.js';
import {
  GamificationConfigService,
  type RewardAmount,
} from './gamification-config.service.js';
import type {
  CoinCapInfo,
  GrantRewardParams,
  MilestoneItem,
  RewardBreakdownEntry,
  RewardResult,
  StreakInfo,
  SurpriseBoostInfo,
} from './gamification.types.js';

type Tx = Prisma.TransactionClient;

const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Exclusive cosmetics for the long streak milestones (docs/10 §1 "Streak
 * milestones at 30/100/365 days → exclusive cosmetics + flair"). Seeded by
 * the `gamification_defaults` migration as inactive items (never sold);
 * granted as UserItem source PROMO (a gift, not a purchase).
 */
export const STREAK_MILESTONE_ITEMS: Record<number, string> = {
  30: 'streak-30-flame-frame',
  100: 'streak-100-blaze-hat',
  365: 'streak-365-phoenix-pet',
};

/**
 * XP sources that never count toward the weekly league (docs/07 §9: the
 * league ranks learning, so a staff grant must not move someone up).
 * Referral XP still counts ("weekly XP from all sources").
 */
export const LEAGUE_EXCLUDED_XP_SOURCES: ReadonlySet<string> = new Set([
  'ADMIN_GRANT',
]);

/** Streak row → the pure-rule state (lastActivityDate is a local day at UTC midnight). */
export function toStreakState(s: {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
  lastActivityDate: Date;
}): StreakState {
  return {
    currentDays: s.currentDays,
    longestDays: s.longestDays,
    freezesAvailable: s.freezesAvailable,
    lastActivityKey: s.lastActivityDate.toISOString().slice(0, 10),
  };
}

/** Coin-journal idempotency key derived from the XP-journal key. */
export function coinKey(idempotencyKey: string): string {
  return `${idempotencyKey}:coin`;
}

/**
 * Server-authoritative reward pipeline (docs/07-gamification.md §11–§12).
 * Every earn flows through `grantReward`, which — atomically —
 *   0. locks the user's row (`SELECT … FOR UPDATE`) so ledger writes for one
 *      user are serialized across concurrent requests,
 *   1. advances the streak (with freeze logic) if the event counts for it,
 *   2. resolves the effective XP/coin multipliers via @codify/domain,
 *   3. writes the XpEvent + CoinTransaction journals (idempotent),
 *   4. bumps User.totalXp / User.coins running totals,
 *   5. detects level-ups.
 * The canonical RewardResult drives the client RewardOrchestrator.
 *
 * Ledger invariant: under the row lock, `User.coins` always equals the latest
 * `CoinTransaction.balanceAfter` and `SUM(delta)` (an opening-balance row is
 * written for pre-ledger coins), so each new `balanceAfter` is computed from
 * the locked `User.coins` — no reliance on createdAt ordering of rows written
 * in the same millisecond.
 */
@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leagues: LeagueAccumulatorService,
    private readonly config: GamificationConfigService,
    private readonly access: AccessService,
  ) {}

  /**
   * Read a user's gamification snapshot for the app header / reconcile.
   * The streak is the *effective* one (docs/07 §6): a row whose last
   * covered day is before yesterday shows the freezes it will consume, or 0
   * when it is lost — never the stale stored count.
   */
  async getSummary(
    userId: string,
    now: Date = new Date(),
  ): Promise<{
    totalXp: number;
    level: number;
    coins: number;
    streak: StreakInfo & { activeToday: boolean };
    surpriseBoost: SurpriseBoostInfo | null;
    weeklyBonusPool: { weekStart: string; coins: number };
  }> {
    const weekStart = currentWeekStart(now);
    const [user, streak, boost, pool] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { totalXp: true, coins: true, timezone: true },
      }),
      this.prisma.streak.findUnique({ where: { userId } }),
      this.activeSurpriseBoost(this.prisma, userId, now),
      this.prisma.coinBonusPool.findUnique({
        where: { userId_weekStart: { userId, weekStart } },
        select: { coins: true },
      }),
    ]);
    const today = localDateKey(now, user.timezone || DEFAULT_TZ);
    const eff = effectiveStreak(streak ? toStreakState(streak) : null, today);
    return {
      totalXp: user.totalXp,
      level: levelFromXp(user.totalXp),
      coins: user.coins,
      streak: eff,
      surpriseBoost: boost,
      weeklyBonusPool: {
        weekStart: weekStart.toISOString(),
        coins: pool?.coins ?? 0,
      },
    };
  }

  /** The user's surprise boost running at `now`, if any. */
  async activeSurpriseBoost(
    db: Pick<Tx, 'multiplier'>,
    userId: string,
    now: Date = new Date(),
  ): Promise<SurpriseBoostInfo | null> {
    const row = await db.multiplier.findFirst({
      where: {
        userId,
        kind: 'SURPRISE_BOOST',
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
    });
    return row ? toBoostInfo(row) : null;
  }

  /** Random source for surprise boosts (replaced in tests). */
  random: () => number = Math.random;

  /**
   * Maybe start a surprise XP boost after a completion (docs/10 §6: rare,
   * ≤ 2 per week, "next 15 minutes 2x XP"). Rolled once per call with
   * `boost.surprise.chancePct`; never while one is running, never more than
   * `maxPerWeek` in the last 7 days. The boost is a per-user
   * SURPRISE_BOOST Multiplier row, so the resolver applies it to every
   * reward until it ends.
   */
  async maybeStartSurpriseBoost(
    tx: Tx,
    userId: string,
    now: Date = new Date(),
  ): Promise<SurpriseBoostInfo | null> {
    const cfg = await this.config.get('boost.surprise', tx);
    if (cfg.chancePct <= 0 || cfg.maxPerWeek <= 0 || cfg.value <= 1)
      return null;
    if (this.random() * 100 >= cfg.chancePct) return null;
    if (await this.activeSurpriseBoost(tx, userId, now)) return null;
    const recent = await tx.multiplier.count({
      where: {
        userId,
        kind: 'SURPRISE_BOOST',
        createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      },
    });
    if (recent >= cfg.maxPerWeek) return null;
    const row = await tx.multiplier.create({
      data: {
        kind: 'SURPRISE_BOOST',
        target: 'XP',
        value: new Prisma.Decimal(cfg.value),
        userId,
        startsAt: now,
        endsAt: new Date(now.getTime() + cfg.minutes * 60_000),
        description: `Surprise boost: ${cfg.value}x XP for ${cfg.minutes} minutes`,
      },
    });
    return toBoostInfo(row);
  }

  /** Grant a reward. Runs in `tx` if given, else opens its own transaction. */
  async grantReward(params: GrantRewardParams, tx?: Tx): Promise<RewardResult> {
    if (tx) return this.grantInTx(tx, params);
    return this.prisma.$transaction((t) => this.grantInTx(t, params));
  }

  /**
   * True when a reward with this idempotency key was already journaled —
   * on either the XP or the coin side (a coin-only reward writes no XpEvent).
   */
  async alreadyGranted(tx: Tx, idempotencyKey: string): Promise<boolean> {
    const [xp, coin] = await Promise.all([
      tx.xpEvent.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      }),
      tx.coinTransaction.findUnique({
        where: { idempotencyKey: coinKey(idempotencyKey) },
        select: { id: true },
      }),
    ]);
    return !!(xp || coin);
  }

  /**
   * Spend coins (a negative ledger entry) — e.g. an item purchase. Atomic,
   * idempotent on `idempotencyKey`, and ledger-consistent (so the drift check
   * keeps holding). Throws 400 if the balance is insufficient.
   *
   * Two guards against overdraw under concurrency: the user row is locked
   * for the rest of the transaction, and the decrement itself is
   * conditional (`coins >= amount`).
   *
   * `capAtBalance` (clawbacks, e.g. a refunded first-payment bonus): take
   * at most the current balance instead of throwing — never negative.
   */
  async spendCoins(
    params: {
      userId: string;
      amount: number;
      source: CoinSource;
      refType?: string | null;
      refId?: string | null;
      idempotencyKey?: string | null;
      capAtBalance?: boolean;
    },
    tx?: Tx,
  ): Promise<{ coins: number; spent: number }> {
    if (!Number.isInteger(params.amount) || params.amount < 0)
      throw new BadRequestException('Invalid amount');
    const run = async (t: Tx) => {
      await this.lockUser(t, params.userId);
      const user = await t.user.findUniqueOrThrow({
        where: { id: params.userId },
        select: { coins: true },
      });
      if (params.idempotencyKey) {
        const seen = await t.coinTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
          select: { id: true },
        });
        if (seen) return { coins: user.coins, spent: 0 };
      }
      const amount = params.capAtBalance
        ? Math.min(params.amount, Math.max(user.coins, 0))
        : params.amount;
      if (user.coins < amount)
        throw new BadRequestException('Insufficient coins');
      if (amount === 0) return { coins: user.coins, spent: 0 };

      await this.ensureOpeningBalance(t, params.userId, user.coins);
      const dec = await t.user.updateMany({
        where: { id: params.userId, coins: { gte: amount } },
        data: { coins: { decrement: amount } },
      });
      if (dec.count !== 1) throw new BadRequestException('Insufficient coins');
      const balanceAfter = user.coins - amount;
      await t.coinTransaction.create({
        data: {
          userId: params.userId,
          delta: -amount,
          source: params.source,
          balanceAfter,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
        },
      });
      return { coins: balanceAfter, spent: amount };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Row-lock the user for the rest of the transaction. Every ledger write
   * goes through here first, so two concurrent grants/spends for the same
   * user run one after the other. Re-entrant within one transaction.
   */
  private async lockUser(tx: Tx, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  }

  /**
   * One-time opening-balance row for coins earned before the ledger existed
   * (pre-Phase-7), so SUM(delta) == latest balanceAfter == User.coins.
   * Must be called with the user row locked.
   */
  private async ensureOpeningBalance(
    tx: Tx,
    userId: string,
    userCoins: number,
  ): Promise<void> {
    if (userCoins <= 0) return;
    const any = await tx.coinTransaction.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (any) return;
    await tx.coinTransaction.create({
      data: {
        userId,
        delta: userCoins,
        source: 'ADMIN_GRANT',
        balanceAfter: userCoins,
        refType: 'opening_balance',
      },
    });
  }

  private async grantInTx(
    tx: Tx,
    params: GrantRewardParams,
  ): Promise<RewardResult> {
    await this.lockUser(tx, params.userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: params.userId },
      select: { totalXp: true, coins: true, timezone: true },
    });

    // Idempotency: a replay with the same key returns the current state
    // without crediting again. Both journals are checked — a coin-only
    // reward (e.g. a streak milestone) writes no XpEvent.
    if (
      params.idempotencyKey &&
      (await this.alreadyGranted(tx, params.idempotencyKey))
    ) {
      return this.noopResult(tx, params.userId, user);
    }

    const now = new Date();
    const tz = params.timezone || user.timezone || DEFAULT_TZ;

    // 1. Streak (before multiplier resolution so today's day counts).
    let streak: StreakInfo | null;
    let reachedMilestone: number | null = null;
    if (params.countsForStreak) {
      const adv = await this.advanceStreak(
        tx,
        params.userId,
        tz,
        params.clientTimestamp,
      );
      streak = {
        currentDays: adv.currentDays,
        longestDays: adv.longestDays,
        freezesAvailable: adv.freezesAvailable,
        extended: adv.extended,
        freezesUsed: adv.freezesUsed,
        restartedAfterLoss: adv.restartedAfterLoss,
      };
      reachedMilestone = adv.reachedMilestone;
    } else {
      streak = await this.readStreak(tx, params.userId, tz, now);
    }

    // 2. Multipliers (skipped for flat rewards — quests/badges/milestones).
    const resolved = params.flat
      ? null
      : resolveMultiplier({
          multipliers: await this.loadMultiplierRules(tx, params.userId),
          isPremium: await this.isPremium(tx, params.userId),
          userId: params.userId,
          now,
          courseId: params.courseId ?? null,
          lessonId: params.lessonId ?? null,
          streakDays: streak?.currentDays ?? 0,
          cap: await this.config.get('multiplier.cap', tx),
        });
    if (resolved && (resolved.xp.capped || resolved.coins.capped)) {
      this.logger.warn(
        `multiplier cap clipped a reward: user=${params.userId} ` +
          `xp ${resolved.xp.uncapped}→${resolved.xp.effective}, ` +
          `coins ${resolved.coins.uncapped}→${resolved.coins.effective} ` +
          `(lesson=${params.lessonId ?? '-'}, course=${params.courseId ?? '-'}, ` +
          `components=${resolved.xp.components.map((c) => `${c.kind}×${c.value}`).join(',')})`,
      );
    }
    const xpMult = resolved ? resolved.xp.effective : 1;
    const coinMult = resolved ? resolved.coins.effective : 1;

    const xp = applyMultiplier(params.baseXp, xpMult);
    const requestedCoins = applyMultiplier(params.baseCoins, coinMult);

    // 2b. Daily per-source coin cap (docs/07 §5, §12): the excess goes to
    //     this week's bonus pool (paid when the week closes), up to its cap.
    const capped = params.uncapped
      ? null
      : await this.applyCoinCap(tx, params, requestedCoins, tz, now);
    const coins = capped ? capped.granted : requestedCoins;

    // 3. Journals (idempotent on key). balanceAfter chains from the locked
    //    User.coins, which equals the latest balanceAfter.
    if (xp > 0) {
      await tx.xpEvent.create({
        data: {
          userId: params.userId,
          source: params.xpSource,
          amount: xp,
          multiplier: new Prisma.Decimal(xpMult),
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
        },
      });
    }
    if (coins !== 0) {
      await this.ensureOpeningBalance(tx, params.userId, user.coins);
      await tx.coinTransaction.create({
        data: {
          userId: params.userId,
          delta: coins,
          source: params.coinSource,
          multiplier: new Prisma.Decimal(coinMult),
          balanceAfter: user.coins + coins,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          // Suffix so XP + Coin keys never collide on the shared unique index.
          idempotencyKey: params.idempotencyKey
            ? coinKey(params.idempotencyKey)
            : null,
        },
      });
    }

    // 4. Running totals.
    const updated = await tx.user.update({
      where: { id: params.userId },
      data: { totalXp: { increment: xp }, coins: { increment: coins } },
      select: { totalXp: true, coins: true },
    });

    // 4b. Weekly league standing — earned XP counts toward the current
    //     cohort; staff grants don't (docs/07 §9 "honest competition").
    if (xp > 0 && !LEAGUE_EXCLUDED_XP_SOURCES.has(params.xpSource))
      await this.leagues.accumulateXp(tx, params.userId, xp);

    // 5. Level-up.
    const levelBefore = levelFromXp(user.totalXp);
    const levelAfter = levelFromXp(updated.totalXp);
    const levelUp =
      levelAfter > levelBefore
        ? { newLevel: levelAfter, xpForNextLevel: xpForLevel(levelAfter + 1) }
        : null;

    const coinCap: CoinCapInfo | null =
      capped && (capped.pooled > 0 || capped.dropped > 0)
        ? {
            requested: requestedCoins,
            pooled: capped.pooled,
            dropped: capped.dropped,
          }
        : null;
    const breakdown = buildBreakdown(params.baseXp, params.baseCoins, resolved);
    if (coinCap) {
      breakdown.push({
        source: 'DAILY_CAP',
        coins: -(coinCap.pooled + coinCap.dropped),
        pooled: coinCap.pooled,
      });
    }
    const result: RewardResult = {
      xp,
      coins,
      multiplier: xpMult,
      xpMultiplier: xpMult,
      coinMultiplier: coinMult,
      breakdown,
      totals: {
        totalXp: updated.totalXp,
        coins: updated.coins,
        level: levelAfter,
      },
      levelUp,
      streak,
      streakMilestone: null,
      coinCap,
    };

    // 5b. Product analytics (docs/07 §13, docs/10 §14 `reward_granted`),
    //     in the same transaction so a rolled-back grant leaves no event.
    if (xp > 0 || coins > 0 || coinCap) {
      await tx.analyticsEvent.create({
        data: {
          userId: params.userId,
          name: 'reward_granted',
          platform: 'server',
          occurredAt: now,
          props: {
            source: params.coinSource,
            xpSource: params.xpSource,
            xp,
            coins,
            coinsPooled: coinCap?.pooled ?? 0,
            multiplierEffective: Math.max(xpMult, coinMult),
            multiplierCapped: !!(
              resolved &&
              (resolved.xp.capped || resolved.coins.capped)
            ),
            lessonId: params.lessonId ?? null,
            courseId: params.courseId ?? null,
          },
        },
      });
    }

    // 6. Streak-day milestone (one-time flat bonus). Granted as its own
    //    journaled, flat (un-multiplied) reward in the same transaction. A
    //    milestone already paid (the streak broke and was rebuilt) is
    //    skipped — never re-paid, never a unique-violation rollback.
    if (reachedMilestone) {
      const table = await this.config.get('streak.milestones', tx);
      const m: RewardAmount | undefined = table[String(reachedMilestone)];
      const key = `streak_milestone:${params.userId}:${reachedMilestone}`;
      if (
        m &&
        (m.xp > 0 || m.coins > 0) &&
        !(await this.alreadyGranted(tx, key))
      ) {
        const bonus = await this.grantInTx(tx, {
          userId: params.userId,
          baseXp: m.xp,
          baseCoins: m.coins,
          xpSource: 'STREAK_MILESTONE',
          coinSource: 'STREAK_MILESTONE',
          refType: 'streak',
          refId: String(reachedMilestone),
          idempotencyKey: key,
          flat: true,
          uncapped: true,
        });
        result.streakMilestone = {
          days: reachedMilestone,
          xp: bonus.xp,
          coins: bonus.coins,
        };
        result.breakdown.push({
          source: 'STREAK_MILESTONE',
          xp: bonus.xp,
          coins: bonus.coins,
        });
        result.totals = bonus.totals;
        if (bonus.levelUp) result.levelUp = bonus.levelUp;
      }
      const item = await this.grantMilestoneItem(
        tx,
        params.userId,
        reachedMilestone,
      );
      if (item) {
        result.streakMilestone = {
          ...(result.streakMilestone ?? {
            days: reachedMilestone,
            xp: 0,
            coins: 0,
          }),
          item,
        };
      }
    }

    return result;
  }

  // ─── Streak ───────────────────────────────────────────────────────────

  /** The streak as it stands now (settled for display, not written). */
  private async readStreak(
    tx: Tx,
    userId: string,
    tz: string,
    now: Date,
  ): Promise<StreakInfo | null> {
    const s = await tx.streak.findUnique({ where: { userId } });
    if (!s) return null;
    const eff = effectiveStreak(toStreakState(s), localDateKey(now, tz));
    return {
      currentDays: eff.currentDays,
      longestDays: eff.longestDays,
      freezesAvailable: eff.freezesAvailable,
    };
  }

  /**
   * Advance the streak for a streak-satisfying action (rules in
   * @codify/domain `advanceStreak`): same local day = no change; missed
   * days are covered by banked freezes, one each; otherwise the streak is
   * lost and restarts at 1. Earns a freeze every 7 days (capped at
   * `streak.freezeCap`). See docs/07 §6.
   */
  private async advanceStreak(
    tx: Tx,
    userId: string,
    timezone: string,
    clientTimestamp?: string | null,
  ): Promise<
    StreakInfo & {
      reachedMilestone: number | null;
      extended: boolean;
      freezesUsed: number;
      restartedAfterLoss: boolean;
    }
  > {
    const tz = timezone || DEFAULT_TZ;
    const at = clientTimestamp ? new Date(clientTimestamp) : new Date();
    const todayKey = localDateKey(at, tz);
    const { 'streak.freezeCap': freezeCap, 'streak.milestones': milestones } =
      await this.config.getMany(['streak.freezeCap', 'streak.milestones'], tx);
    const milestoneFor = (days: number) =>
      String(days) in milestones || days in STREAK_MILESTONE_ITEMS
        ? days
        : null;

    const existing = await tx.streak.findUnique({ where: { userId } });
    const next = advanceStreakRule(
      existing ? toStreakState(existing) : null,
      todayKey,
      freezeCap,
    );
    if (next.changed) {
      const data = {
        currentDays: next.currentDays,
        longestDays: next.longestDays,
        freezesAvailable: next.freezesAvailable,
        lastActivityDate: new Date(`${next.lastActivityKey}T00:00:00Z`),
      };
      if (existing) await tx.streak.update({ where: { userId }, data });
      else await tx.streak.create({ data: { userId, ...data } });
    }
    return {
      currentDays: next.currentDays,
      longestDays: next.longestDays,
      freezesAvailable: next.freezesAvailable,
      extended: next.extended,
      freezesUsed: next.freezesUsed,
      restartedAfterLoss: next.restartedAfterLoss,
      reachedMilestone: next.extended ? milestoneFor(next.currentDays) : null,
    };
  }

  /** Give the milestone's exclusive cosmetic once (skipped if not seeded). */
  private async grantMilestoneItem(
    tx: Tx,
    userId: string,
    days: number,
  ): Promise<MilestoneItem | null> {
    const slug = STREAK_MILESTONE_ITEMS[days];
    if (!slug) return null;
    const item = await tx.item.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, deletedAt: true },
    });
    if (!item || item.deletedAt) return null;
    const res = await tx.userItem.createMany({
      data: [{ userId, itemId: item.id, source: 'PROMO' }],
      skipDuplicates: true,
    });
    return res.count > 0
      ? { id: item.id, slug: item.slug, name: item.name }
      : null;
  }

  /**
   * Split `requested` coins against the source's daily cap, moving the
   * excess into this week's CoinBonusPool. Returns null for an uncapped
   * source. Runs under the user row lock, so the "earned today" sum and the
   * pool can't race.
   */
  private async applyCoinCap(
    tx: Tx,
    params: GrantRewardParams,
    requested: number,
    tz: string,
    now: Date,
  ): Promise<{ granted: number; pooled: number; dropped: number } | null> {
    if (requested <= 0) return null;
    const { 'coins.dailyCaps': caps, 'coins.weeklyPoolCap': poolCap } =
      await this.config.getMany(['coins.dailyCaps', 'coins.weeklyPoolCap'], tx);
    const cap = caps[params.coinSource];
    if (cap === undefined) return null;
    const weekStart = currentWeekStart(now);
    const [today, pool] = await Promise.all([
      tx.coinTransaction.aggregate({
        where: {
          userId: params.userId,
          source: params.coinSource,
          delta: { gt: 0 },
          createdAt: { gte: localDayStart(now, tz) },
        },
        _sum: { delta: true },
      }),
      tx.coinBonusPool.findUnique({
        where: { userId_weekStart: { userId: params.userId, weekStart } },
        select: { coins: true },
      }),
    ]);
    const split = splitCoinsByCap({
      amount: requested,
      earnedTodayFromSource: today._sum.delta ?? 0,
      dailyCap: cap,
      poolSoFar: pool?.coins ?? 0,
      poolCap,
    });
    if (split.pooled > 0) {
      await tx.coinBonusPool.upsert({
        where: { userId_weekStart: { userId: params.userId, weekStart } },
        create: { userId: params.userId, weekStart, coins: split.pooled },
        update: { coins: { increment: split.pooled } },
      });
    }
    if (split.pooled > 0 || split.dropped > 0) {
      this.logger.log(
        `daily cap ${params.coinSource}=${cap}: user=${params.userId} ` +
          `requested ${requested}, granted ${split.granted}, pooled ${split.pooled}, dropped ${split.dropped}`,
      );
    }
    return split;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private isPremium(tx: Tx, userId: string): Promise<boolean> {
    return this.access.hasActiveSubscription(userId, tx);
  }

  private async loadMultiplierRules(
    tx: Tx,
    userId: string,
  ): Promise<MultiplierRule[]> {
    // Global rules + this user's own (SURPRISE_BOOST) — never other users'.
    const rows = await tx.multiplier.findMany({
      where: { isActive: true, OR: [{ userId: null }, { userId }] },
    });
    return rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      target: m.target,
      value: Number(m.value),
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      courseId: m.courseId,
      lessonId: m.lessonId,
      streakDaysMin: m.streakDaysMin,
      userId: m.userId,
      description: m.description,
    }));
  }

  private async noopResult(
    tx: Tx,
    userId: string,
    user: { totalXp: number; coins: number },
  ): Promise<RewardResult> {
    const streak = await this.readStreak(tx, userId, DEFAULT_TZ, new Date());
    return {
      xp: 0,
      coins: 0,
      multiplier: 1,
      xpMultiplier: 1,
      coinMultiplier: 1,
      breakdown: [],
      totals: {
        totalXp: user.totalXp,
        coins: user.coins,
        level: levelFromXp(user.totalXp),
      },
      levelUp: null,
      streak,
    };
  }
}

function toBoostInfo(row: {
  id: string;
  value: Prisma.Decimal | number;
  target: 'XP' | 'COINS' | 'BOTH';
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
}): SurpriseBoostInfo {
  return {
    id: row.id,
    value: Number(row.value),
    target: row.target,
    startsAt: (row.startsAt ?? row.createdAt).toISOString(),
    endsAt: (row.endsAt ?? row.createdAt).toISOString(),
  };
}

/**
 * Reward breakdown for the client toast (docs/07 §3): the base amounts, then
 * one line per multiplier factor with the side it applies to (so coin-only
 * promos are visible too). Bonus lines are appended by the callers.
 */
function buildBreakdown(
  baseXp: number,
  baseCoins: number,
  resolved: ReturnType<typeof resolveMultiplier> | null,
): RewardBreakdownEntry[] {
  const entries: RewardBreakdownEntry[] = [
    { source: 'base', xp: baseXp, coins: baseCoins },
  ];
  if (resolved) {
    const coinKinds = new Map(
      resolved.coins.components.map((c) => [c.kind, c.value]),
    );
    for (const c of resolved.xp.components) {
      const both = coinKinds.get(c.kind) === c.value;
      entries.push({
        source: c.kind,
        multiplier: c.value,
        appliesTo: both ? 'both' : 'xp',
      });
      if (both) coinKinds.delete(c.kind);
    }
    for (const [kind, value] of coinKinds) {
      entries.push({ source: kind, multiplier: value, appliesTo: 'coins' });
    }
  }
  return entries;
}
