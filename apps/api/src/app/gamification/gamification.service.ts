import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type CoinSource } from '@prisma/client';
import {
  applyMultiplier,
  resolveMultiplier,
  type MultiplierRule,
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
  GrantRewardParams,
  RewardResult,
  StreakInfo,
} from './gamification.types.js';

type Tx = Prisma.TransactionClient;

const DEFAULT_TZ = 'America/Sao_Paulo';

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

  /** Read a user's gamification snapshot for the app header / reconcile. */
  async getSummary(userId: string): Promise<{
    totalXp: number;
    level: number;
    coins: number;
    streak: StreakInfo;
  }> {
    const [user, streak] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { totalXp: true, coins: true },
      }),
      this.prisma.streak.findUnique({ where: { userId } }),
    ]);
    return {
      totalXp: user.totalXp,
      level: levelFromXp(user.totalXp),
      coins: user.coins,
      streak: streak
        ? {
            currentDays: streak.currentDays,
            longestDays: streak.longestDays,
            freezesAvailable: streak.freezesAvailable,
          }
        : { currentDays: 0, longestDays: 0, freezesAvailable: 0 },
    };
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
   */
  async spendCoins(
    params: {
      userId: string;
      amount: number;
      source: CoinSource;
      refType?: string | null;
      refId?: string | null;
      idempotencyKey?: string | null;
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
      if (user.coins < params.amount)
        throw new BadRequestException('Insufficient coins');
      if (params.amount === 0) return { coins: user.coins, spent: 0 };

      await this.ensureOpeningBalance(t, params.userId, user.coins);
      const dec = await t.user.updateMany({
        where: { id: params.userId, coins: { gte: params.amount } },
        data: { coins: { decrement: params.amount } },
      });
      if (dec.count !== 1) throw new BadRequestException('Insufficient coins');
      const balanceAfter = user.coins - params.amount;
      await t.coinTransaction.create({
        data: {
          userId: params.userId,
          delta: -params.amount,
          source: params.source,
          balanceAfter,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
        },
      });
      return { coins: balanceAfter, spent: params.amount };
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

    // 1. Streak (before multiplier resolution so today's day counts).
    let streak: StreakInfo | null;
    let reachedMilestone: number | null = null;
    if (params.countsForStreak) {
      const adv = await this.advanceStreak(
        tx,
        params.userId,
        params.timezone ?? user.timezone,
        params.clientTimestamp,
      );
      streak = {
        currentDays: adv.currentDays,
        longestDays: adv.longestDays,
        freezesAvailable: adv.freezesAvailable,
      };
      reachedMilestone = adv.reachedMilestone;
    } else {
      streak = await this.readStreak(tx, params.userId);
    }

    // 2. Multipliers (skipped for flat rewards — quests/badges/milestones).
    const resolved = params.flat
      ? null
      : resolveMultiplier({
          multipliers: await this.loadMultiplierRules(tx),
          isPremium: await this.isPremium(tx, params.userId),
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
    const coins = applyMultiplier(params.baseCoins, coinMult);

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

    // 4b. Weekly league standing — all XP counts toward the current cohort.
    if (xp > 0) await this.leagues.accumulateXp(tx, params.userId, xp);

    // 5. Level-up.
    const levelBefore = levelFromXp(user.totalXp);
    const levelAfter = levelFromXp(updated.totalXp);
    const levelUp =
      levelAfter > levelBefore
        ? { newLevel: levelAfter, xpForNextLevel: xpForLevel(levelAfter + 1) }
        : null;

    const result: RewardResult = {
      xp,
      coins,
      multiplier: xpMult,
      xpMultiplier: xpMult,
      coinMultiplier: coinMult,
      breakdown: buildBreakdown(params.baseXp, params.baseCoins, resolved),
      totals: {
        totalXp: updated.totalXp,
        coins: updated.coins,
        level: levelAfter,
      },
      levelUp,
      streak,
      streakMilestone: null,
    };

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
        });
        result.streakMilestone = {
          days: reachedMilestone,
          xp: bonus.xp,
          coins: bonus.coins,
        };
        result.totals = bonus.totals;
        if (bonus.levelUp) result.levelUp = bonus.levelUp;
      }
    }

    return result;
  }

  // ─── Streak ───────────────────────────────────────────────────────────

  private async readStreak(tx: Tx, userId: string): Promise<StreakInfo | null> {
    const s = await tx.streak.findUnique({ where: { userId } });
    return s
      ? {
          currentDays: s.currentDays,
          longestDays: s.longestDays,
          freezesAvailable: s.freezesAvailable,
        }
      : null;
  }

  /**
   * Advance the streak for a streak-satisfying action. Same local day = no
   * change; next local day = +1; a gap consumes banked freezes (one per
   * missed day) and otherwise resets to 1. Earns a freeze every 7 days
   * (capped at `streak.freezeCap`). See docs/07 §6.
   */
  private async advanceStreak(
    tx: Tx,
    userId: string,
    timezone: string,
    clientTimestamp?: string | null,
  ): Promise<StreakInfo & { reachedMilestone: number | null }> {
    const tz = timezone || DEFAULT_TZ;
    const at = clientTimestamp ? new Date(clientTimestamp) : new Date();
    const todayKey = localDateKey(at, tz);
    const todayDate = new Date(`${todayKey}T00:00:00Z`);
    const { 'streak.freezeCap': freezeCap, 'streak.milestones': milestones } =
      await this.config.getMany(['streak.freezeCap', 'streak.milestones'], tx);
    const milestoneFor = (days: number) =>
      String(days) in milestones ? days : null;

    const existing = await tx.streak.findUnique({ where: { userId } });
    if (!existing) {
      const created = await tx.streak.create({
        data: {
          userId,
          currentDays: 1,
          longestDays: 1,
          freezesAvailable: 0,
          lastActivityDate: todayDate,
        },
      });
      return { ...toStreakInfo(created), reachedMilestone: milestoneFor(1) };
    }

    const lastKey = localDateKey(existing.lastActivityDate, 'UTC');
    const diff = dayDiff(todayKey, lastKey);

    let currentDays = existing.currentDays;
    let freezesAvailable = existing.freezesAvailable;

    if (diff <= 0) {
      // Same day (or clock skew) — already counted today; no new milestone.
      return { ...toStreakInfo(existing), reachedMilestone: null };
    } else if (diff === 1) {
      currentDays += 1;
    } else {
      const missed = diff - 1;
      if (missed <= freezesAvailable) {
        freezesAvailable -= missed; // freezes cover the gap; streak survives
        currentDays += 1;
      } else {
        currentDays = 1; // streak broken
      }
    }

    // Earn a freeze on each new 7-day milestone, capped.
    if (currentDays % 7 === 0 && freezesAvailable < freezeCap) {
      freezesAvailable += 1;
    }

    const longestDays = Math.max(existing.longestDays, currentDays);
    const updated = await tx.streak.update({
      where: { userId },
      data: {
        currentDays,
        longestDays,
        freezesAvailable,
        lastActivityDate: todayDate,
      },
    });
    return {
      ...toStreakInfo(updated),
      reachedMilestone: milestoneFor(currentDays),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private isPremium(tx: Tx, userId: string): Promise<boolean> {
    return this.access.hasActiveSubscription(userId, tx);
  }

  private async loadMultiplierRules(tx: Tx): Promise<MultiplierRule[]> {
    const rows = await tx.multiplier.findMany({ where: { isActive: true } });
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
      description: m.description,
    }));
  }

  private async noopResult(
    tx: Tx,
    userId: string,
    user: { totalXp: number; coins: number },
  ): Promise<RewardResult> {
    const streak = await this.readStreak(tx, userId);
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

function toStreakInfo(s: {
  currentDays: number;
  longestDays: number;
  freezesAvailable: number;
}): StreakInfo {
  return {
    currentDays: s.currentDays,
    longestDays: s.longestDays,
    freezesAvailable: s.freezesAvailable,
  };
}

function buildBreakdown(
  baseXp: number,
  baseCoins: number,
  resolved: ReturnType<typeof resolveMultiplier> | null,
): RewardResult['breakdown'] {
  const entries: RewardResult['breakdown'] = [
    { source: 'base', xp: baseXp, coins: baseCoins },
  ];
  if (resolved) {
    for (const c of resolved.xp.components) {
      entries.push({ source: c.kind, multiplier: c.value });
    }
  }
  return entries;
}

/** User-local calendar date as YYYY-MM-DD (en-CA renders ISO-like).  */
function localDateKey(ts: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ts);
}

/** Whole-day difference a − b for YYYY-MM-DD keys. */
function dayDiff(aKey: string, bKey: string): number {
  return Math.round(
    (Date.parse(`${aKey}T00:00:00Z`) - Date.parse(`${bKey}T00:00:00Z`)) /
      86_400_000,
  );
}
