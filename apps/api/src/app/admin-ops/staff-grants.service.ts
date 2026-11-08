import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** docs/14 §2: SUPPORT cannot grant more than 1,000 coins (per grant). */
export const SUPPORT_MAX_COINS_PER_GRANT = 1_000;
export const GRANT_AUDIT_ACTION = 'user.coins_granted';

/** Per-staff-member daily limits (UTC day), from the environment. */
export interface GrantLimits {
  supportDailyCoins: number;
  adminDailyCoins: number;
  adminDailyXp: number;
}

export function grantLimitsFromEnv(
  env: Record<string, string | undefined>,
): GrantLimits {
  const int = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v && Number.isInteger(n) && n >= 0 ? n : d;
  };
  return {
    supportDailyCoins: int(env['GRANT_DAILY_COIN_LIMIT_SUPPORT'], 3_000),
    adminDailyCoins: int(env['GRANT_DAILY_COIN_LIMIT_ADMIN'], 50_000),
    adminDailyXp: int(env['GRANT_DAILY_XP_LIMIT_ADMIN'], 50_000),
  };
}

export interface GrantInput {
  coins?: number;
  xp?: number;
  reason: string;
}

export interface GrantResult {
  userId: string;
  coins: number;
  xp: number;
  before: { coins: number; totalXp: number };
  after: { coins: number; totalXp: number };
  /** What the actor may still grant today (UTC). */
  remainingToday: { coins: number; xp: number };
}

export interface GrantRequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Manual coin / XP grant (docs/04 Users "Manual grant", docs/14 §2).
 * Written through GamificationService.grantReward (source ADMIN_GRANT,
 * flat — no multipliers), so the ledger stays the single source of truth.
 *
 * Rules: SUPPORT grants coins only, ≤ 1,000 per grant; every staff member
 * has a daily (UTC) limit — counted from their own `user.coins_granted`
 * audit rows. The limit check, the ledger write and the audit row share
 * one transaction under a per-actor advisory lock, so two grants racing
 * can't both slip under the limit.
 */
@Injectable()
export class StaffGrantsService {
  readonly limits: GrantLimits = grantLimitsFromEnv(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  async grant(
    actor: ApiUser,
    userId: string,
    input: GrantInput,
    meta: GrantRequestMeta,
    now = new Date(),
  ): Promise<GrantResult> {
    const coins = input.coins ?? 0;
    const xp = input.xp ?? 0;
    const reason = input.reason.trim();
    if (coins <= 0 && xp <= 0)
      throw new BadRequestException({
        code: 'GRANT_EMPTY',
        message: 'Grant at least one coin or XP point',
      });
    if (reason.length < 3)
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason of at least 3 characters is required',
      });
    const isAdmin = actor.role === 'ADMIN';
    if (!isAdmin && xp > 0)
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: 'Only an admin can grant XP',
        requiredRole: 'ADMIN',
      });
    if (!isAdmin && coins > SUPPORT_MAX_COINS_PER_GRANT)
      throw new ForbiddenException({
        code: 'GRANT_CAP_EXCEEDED',
        message: `Support can grant at most ${SUPPORT_MAX_COINS_PER_GRANT} coins at a time — ask an admin for more`,
        capCoins: SUPPORT_MAX_COINS_PER_GRANT,
        requiredRole: 'ADMIN',
      });

    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, purgedAt: null },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const dailyCoins = isAdmin
      ? this.limits.adminDailyCoins
      : this.limits.supportDailyCoins;
    const dailyXp = isAdmin ? this.limits.adminDailyXp : 0;
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    return this.prisma.$transaction(async (tx) => {
      // Serialize this actor's grants so the limit check holds.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff_grant:${actor.userId}`}))`;
      const used = await usedToday(tx, actor.userId, dayStart);
      if (used.coins + coins > dailyCoins || used.xp + xp > dailyXp)
        throw new ForbiddenException({
          code: 'GRANT_DAILY_LIMIT',
          message: `Daily grant limit reached (coins ${used.coins}/${dailyCoins}, XP ${used.xp}/${dailyXp} today)`,
          usedToday: used,
          limit: { coins: dailyCoins, xp: dailyXp },
        });

      const before = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { coins: true, totalXp: true },
      });
      const grantId = randomUUID();
      await this.gamification.grantReward(
        {
          userId,
          baseXp: xp,
          baseCoins: coins,
          xpSource: 'ADMIN_GRANT',
          coinSource: 'ADMIN_GRANT',
          refType: 'admin_grant',
          refId: grantId,
          idempotencyKey: `admin_grant:${grantId}`,
          flat: true,
        },
        tx,
      );
      const after = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { coins: true, totalXp: true },
      });
      await tx.auditLog.create({
        data: {
          action: GRANT_AUDIT_ACTION,
          actorId: actor.userId,
          actorRole: actor.role,
          entity: 'User',
          entityId: userId,
          diff: {
            coins,
            xp,
            reason,
            grantId,
            source: 'ADMIN_GRANT',
            before,
            after,
          } as Prisma.InputJsonValue,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      return {
        userId,
        coins,
        xp,
        before,
        after,
        remainingToday: {
          coins: Math.max(0, dailyCoins - used.coins - coins),
          xp: Math.max(0, dailyXp - used.xp - xp),
        },
      };
    });
  }

  /** What `actor` has granted / may still grant today (for the form). */
  async allowance(
    actor: ApiUser,
    now = new Date(),
  ): Promise<{
    usedToday: { coins: number; xp: number };
    limit: { coins: number; xp: number };
    maxCoinsPerGrant: number | null;
  }> {
    const isAdmin = actor.role === 'ADMIN';
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return {
      usedToday: await usedToday(this.prisma, actor.userId, dayStart),
      limit: {
        coins: isAdmin
          ? this.limits.adminDailyCoins
          : this.limits.supportDailyCoins,
        xp: isAdmin ? this.limits.adminDailyXp : 0,
      },
      maxCoinsPerGrant: isAdmin ? null : SUPPORT_MAX_COINS_PER_GRANT,
    };
  }
}

async function usedToday(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  actorId: string,
  since: Date,
): Promise<{ coins: number; xp: number }> {
  const rows = await db.$queryRaw<
    { coins: bigint | null; xp: bigint | null }[]
  >`
    SELECT COALESCE(SUM((diff->>'coins')::int), 0) AS coins,
           COALESCE(SUM((diff->>'xp')::int), 0) AS xp
    FROM "AuditLog"
    WHERE action = ${GRANT_AUDIT_ACTION} AND "actorId" = ${actorId}
      AND "createdAt" >= ${since}`;
  return { coins: Number(rows[0]?.coins ?? 0), xp: Number(rows[0]?.xp ?? 0) };
}
