import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyMultiplier,
  resolveMultiplier,
  subscriptionGrantsAccess,
  type MultiplierRule,
} from '@codify/domain';
import { levelFromXp, xpForLevel } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import type { GrantRewardParams, RewardResult, StreakInfo } from './gamification.types.js';

type Tx = Prisma.TransactionClient;

const DEFAULT_TZ = 'America/Sao_Paulo';
/** Earn a freeze every 7 streak days, capped at this many banked. */
const MAX_FREEZES = 2;

/**
 * Server-authoritative reward pipeline (docs/07-gamification.md §11–§12).
 * Every earn flows through `grantReward`, which — atomically —
 *   1. advances the streak (with freeze logic) if the event counts for it,
 *   2. resolves the effective XP/coin multipliers via @codify/domain,
 *   3. writes the XpEvent + CoinTransaction journals (idempotent),
 *   4. bumps User.totalXp / User.coins running totals,
 *   5. detects level-ups.
 * The canonical RewardResult drives the client RewardOrchestrator.
 */
@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Grant a reward. Runs in `tx` if given, else opens its own transaction. */
  async grantReward(params: GrantRewardParams, tx?: Tx): Promise<RewardResult> {
    if (tx) return this.grantInTx(tx, params);
    return this.prisma.$transaction((t) => this.grantInTx(t, params));
  }

  private async grantInTx(tx: Tx, params: GrantRewardParams): Promise<RewardResult> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: params.userId },
      select: { totalXp: true, coins: true, timezone: true },
    });

    // Idempotency: a replay with the same key returns the current state
    // without crediting again.
    if (params.idempotencyKey) {
      const seen = await tx.xpEvent.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
        select: { id: true },
      });
      if (seen) return this.noopResult(tx, params.userId, user);
    }

    // 1. Streak (before multiplier resolution so today's day counts).
    const streak = params.countsForStreak
      ? await this.advanceStreak(tx, params.userId, params.timezone ?? user.timezone, params.clientTimestamp)
      : await this.readStreak(tx, params.userId);

    // 2. Multipliers.
    const isPremium = await this.isPremium(tx, params.userId);
    const rules = await this.loadMultiplierRules(tx);
    const cap = await this.readCap(tx);
    const resolved = resolveMultiplier({
      multipliers: rules,
      isPremium,
      courseId: params.courseId ?? null,
      lessonId: params.lessonId ?? null,
      streakDays: streak?.currentDays ?? 0,
      cap,
    });

    const xp = applyMultiplier(params.baseXp, resolved.xp.effective);
    const coins = applyMultiplier(params.baseCoins, resolved.coins.effective);

    // 3. Journals (idempotent on key).
    // Chain balanceAfter from the ledger (not User.coins) so the ledger stays
    // self-consistent — SUM(delta) == latest balanceAfter. If the user earned
    // coins before the ledger existed (pre-Phase-7), write a one-time opening
    // balance so those coins are represented in the ledger too.
    const last = await tx.coinTransaction.findFirst({
      where: { userId: params.userId },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    let prevBalance = last?.balanceAfter ?? null;
    if (prevBalance === null && user.coins > 0) {
      await tx.coinTransaction.create({
        data: {
          userId: params.userId,
          delta: user.coins,
          source: 'ADMIN_GRANT',
          balanceAfter: user.coins,
          refType: 'opening_balance',
        },
      });
      prevBalance = user.coins;
    } else if (prevBalance === null) {
      prevBalance = 0;
    }
    const balanceAfter = prevBalance + coins;
    if (xp > 0) {
      await tx.xpEvent.create({
        data: {
          userId: params.userId,
          source: params.xpSource,
          amount: xp,
          multiplier: new Prisma.Decimal(resolved.xp.effective),
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
        },
      });
    }
    if (coins !== 0) {
      await tx.coinTransaction.create({
        data: {
          userId: params.userId,
          delta: coins,
          source: params.coinSource,
          multiplier: new Prisma.Decimal(resolved.coins.effective),
          balanceAfter,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          // Suffix so XP + Coin keys never collide on the shared unique index.
          idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:coin` : null,
        },
      });
    }

    // 4. Running totals.
    const updated = await tx.user.update({
      where: { id: params.userId },
      data: { totalXp: { increment: xp }, coins: { increment: coins } },
      select: { totalXp: true, coins: true },
    });

    // 5. Level-up.
    const levelBefore = levelFromXp(user.totalXp);
    const levelAfter = levelFromXp(updated.totalXp);
    const levelUp =
      levelAfter > levelBefore
        ? { newLevel: levelAfter, xpForNextLevel: xpForLevel(levelAfter + 1) }
        : null;

    return {
      xp,
      coins,
      multiplier: resolved.xp.effective,
      xpMultiplier: resolved.xp.effective,
      coinMultiplier: resolved.coins.effective,
      breakdown: buildBreakdown(params.baseXp, params.baseCoins, resolved),
      totals: { totalXp: updated.totalXp, coins: updated.coins, level: levelAfter },
      levelUp,
      streak,
    };
  }

  // ─── Streak ───────────────────────────────────────────────────────────

  private async readStreak(tx: Tx, userId: string): Promise<StreakInfo | null> {
    const s = await tx.streak.findUnique({ where: { userId } });
    return s
      ? { currentDays: s.currentDays, longestDays: s.longestDays, freezesAvailable: s.freezesAvailable }
      : null;
  }

  /**
   * Advance the streak for a streak-satisfying action. Same local day = no
   * change; next local day = +1; a gap consumes banked freezes (one per
   * missed day) and otherwise resets to 1. Earns a freeze every 7 days
   * (capped at MAX_FREEZES). See docs/07 §6.
   */
  private async advanceStreak(
    tx: Tx,
    userId: string,
    timezone: string,
    clientTimestamp?: string | null,
  ): Promise<StreakInfo> {
    const tz = timezone || DEFAULT_TZ;
    const at = clientTimestamp ? new Date(clientTimestamp) : new Date();
    const todayKey = localDateKey(at, tz);
    const todayDate = new Date(`${todayKey}T00:00:00Z`);

    const existing = await tx.streak.findUnique({ where: { userId } });
    if (!existing) {
      const created = await tx.streak.create({
        data: { userId, currentDays: 1, longestDays: 1, freezesAvailable: 0, lastActivityDate: todayDate },
      });
      return toStreakInfo(created);
    }

    const lastKey = localDateKey(existing.lastActivityDate, 'UTC');
    const diff = dayDiff(todayKey, lastKey);

    let currentDays = existing.currentDays;
    let freezesAvailable = existing.freezesAvailable;

    if (diff <= 0) {
      // Same day (or clock skew) — already counted today.
      return toStreakInfo(existing);
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
    if (currentDays % 7 === 0 && freezesAvailable < MAX_FREEZES) {
      freezesAvailable += 1;
    }

    const longestDays = Math.max(existing.longestDays, currentDays);
    const updated = await tx.streak.update({
      where: { userId },
      data: { currentDays, longestDays, freezesAvailable, lastActivityDate: todayDate },
    });
    return toStreakInfo(updated);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async isPremium(tx: Tx, userId: string): Promise<boolean> {
    const subs = await tx.subscription.findMany({
      where: { userId },
      select: { status: true, currentPeriodEnd: true, planId: true },
    });
    const now = new Date();
    return subs.some((s) =>
      subscriptionGrantsAccess({ planId: s.planId, status: s.status, currentPeriodEnd: s.currentPeriodEnd }, now),
    );
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

  private async readCap(tx: Tx): Promise<number | undefined> {
    const row = await tx.gamificationConfig.findUnique({ where: { key: 'multiplier.cap' } });
    const v = row?.value;
    return typeof v === 'number' ? v : undefined;
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
      totals: { totalXp: user.totalXp, coins: user.coins, level: levelFromXp(user.totalXp) },
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
  return { currentDays: s.currentDays, longestDays: s.longestDays, freezesAvailable: s.freezesAvailable };
}

function buildBreakdown(
  baseXp: number,
  baseCoins: number,
  resolved: ReturnType<typeof resolveMultiplier>,
): RewardResult['breakdown'] {
  const entries: RewardResult['breakdown'] = [
    { source: 'base', xp: baseXp, coins: baseCoins },
  ];
  for (const c of resolved.xp.components) {
    entries.push({ source: c.kind, multiplier: c.value });
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
  return Math.round((Date.parse(`${aKey}T00:00:00Z`) - Date.parse(`${bKey}T00:00:00Z`)) / 86_400_000);
}
