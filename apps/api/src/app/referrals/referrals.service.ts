import { Cron } from '@nestjs/schedule';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { GamificationConfigService } from '../gamification/gamification-config.service.js';
import { jobsEnabled, ENGAGEMENT_CRONS } from '../gamification/jobs.js';

/** Crockford base32 — no I/L/O/U, so codes survive being read aloud. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
/** Guard against pathological referral chains when checking for cycles. */
const MAX_CHAIN_DEPTH = 50;
const REWARD_BATCH = 200;

export interface ReferralView {
  code: string;
  shareUrl: string;
  /** Users who signed up with this code (kept for existing clients). */
  referredCount: number;
  /** Same as referredCount. */
  invited: number;
  /** Referees who completed at least one lesson. */
  converted: number;
  /** Rewards paid to the caller for converted referees. */
  rewards: { count: number; xp: number; coins: number };
}

export interface ClaimReferralResult {
  status: 'claimed' | 'already_claimed';
}

export interface ReferralRewardRun {
  candidates: number;
  rewarded: number;
}

/** Idempotency key of the referrer reward for one referee (docs/18). */
export function referralRewardKey(refereeId: string): string {
  return `referral:${refereeId}`;
}

/**
 * Referral codes, attribution and rewards (docs/18-growth.md).
 *
 * - Every user has a lazily-generated `referralCode` (also their friend
 *   invite code) and a share URL `<STUDENT_APP_URL>/r/<code>`.
 * - A new user claims a code once, within `referral.claimWindowDays` of
 *   signing up; never their own and never one that would make a cycle.
 * - Once the referee completes their first lesson, the referrer earns
 *   `referral.reward` — paid by an hourly job, idempotent per referee.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly config: GamificationConfigService,
  ) {}

  shareUrl(code: string): string {
    const base = (
      process.env['STUDENT_APP_URL'] ?? 'https://codify.app'
    ).replace(/\/$/, '');
    return `${base}/r/${code}`;
  }

  /** The user's referral code, generated on first use. */
  async getOrCreateCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (user.referralCode) return user.referralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newReferralCode();
      try {
        // Conditional: a concurrent request may have set one already.
        const res = await this.prisma.user.updateMany({
          where: { id: userId, referralCode: null },
          data: { referralCode: code },
        });
        if (res.count === 1) return code;
        const again = await this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { referralCode: true },
        });
        if (again.referralCode) return again.referralCode;
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new InternalServerErrorException(
      'Could not allocate a referral code',
    );
  }

  async getSummary(userId: string): Promise<ReferralView> {
    const code = await this.getOrCreateCode(userId);
    const [invited, converted, rewards] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.user.count({
        where: { referredById: userId, progress: { some: {} } },
      }),
      this.prisma.coinTransaction.aggregate({
        where: { userId, refType: 'referral' },
        _sum: { delta: true },
        _count: { _all: true },
      }),
    ]);
    const xp = await this.prisma.xpEvent.aggregate({
      where: { userId, refType: 'referral' },
      _sum: { amount: true },
    });
    return {
      code,
      shareUrl: this.shareUrl(code),
      referredCount: invited,
      invited,
      converted,
      rewards: {
        count: rewards._count._all,
        xp: xp._sum.amount ?? 0,
        coins: rewards._sum.delta ?? 0,
      },
    };
  }

  /**
   * Attribute the caller's signup to the owner of `code`. Set once
   * (claiming the same code again is a no-op; a different one is 409),
   * only within the claim window after signup, never self, never circular.
   */
  async claim(
    userId: string,
    rawCode: string,
    now: Date = new Date(),
  ): Promise<ClaimReferralResult> {
    const code = rawCode.trim().toUpperCase();
    const [me, referrer] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, createdAt: true, referredById: true },
      }),
      this.prisma.user.findFirst({
        where: { referralCode: code, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!referrer) throw new NotFoundException('Referral code not found');
    if (referrer.id === userId)
      throw new BadRequestException('You cannot refer yourself');
    if (me.referredById) {
      if (me.referredById === referrer.id) return { status: 'already_claimed' };
      throw new ConflictException(
        'A referral has already been claimed for this account',
      );
    }

    const windowDays = await this.config.get('referral.claimWindowDays');
    if (now.getTime() - me.createdAt.getTime() > windowDays * 86_400_000) {
      throw new BadRequestException(
        `Referral codes can only be claimed within ${windowDays} days of signing up`,
      );
    }
    if (await this.wouldCycle(userId, referrer.id)) {
      throw new BadRequestException('Circular referrals are not allowed');
    }

    // Conditional write: two concurrent claims can't both attribute.
    const res = await this.prisma.user.updateMany({
      where: { id: userId, referredById: null },
      data: { referredById: referrer.id },
    });
    if (res.count === 0) {
      const after = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { referredById: true },
      });
      if (after.referredById === referrer.id)
        return { status: 'already_claimed' };
      throw new ConflictException(
        'A referral has already been claimed for this account',
      );
    }
    return { status: 'claimed' };
  }

  /** True when `referrerId`'s own referral chain leads back to `userId`. */
  private async wouldCycle(
    userId: string,
    referrerId: string,
  ): Promise<boolean> {
    let cursor: string | null = referrerId;
    for (let depth = 0; cursor && depth < MAX_CHAIN_DEPTH; depth++) {
      if (cursor === userId) return true;
      const row: { referredById: string | null } | null =
        await this.prisma.user.findUnique({
          where: { id: cursor },
          select: { referredById: true },
        });
      cursor = row?.referredById ?? null;
    }
    return false;
  }

  /**
   * Pay referrers for referees who completed their first lesson and haven't
   * been paid for yet. Idempotent per referee (`referral:<refereeId>`), so
   * overlapping runs and retries never double-pay.
   *
   * is the job entry point.
   */
  async grantPendingRewards(): Promise<ReferralRewardRun> {
    const reward = await this.config.get('referral.reward');
    if (reward.xp <= 0 && reward.coins <= 0)
      return { candidates: 0, rewarded: 0 };

    const rows = await this.prisma.$queryRaw<
      { refereeId: string; referrerId: string }[]
    >`
      SELECT u.id AS "refereeId", u."referredById" AS "referrerId"
      FROM "User" u
      JOIN "User" r ON r.id = u."referredById" AND r."deletedAt" IS NULL
      WHERE u."referredById" IS NOT NULL
        AND u."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "Progress" p WHERE p."userId" = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM "XpEvent" x WHERE x."idempotencyKey" = 'referral:' || u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM "CoinTransaction" c WHERE c."idempotencyKey" = 'referral:' || u.id || ':coin'
        )
      ORDER BY u."createdAt"
      LIMIT ${REWARD_BATCH}
    `;

    let rewarded = 0;
    for (const row of rows) {
      try {
        const res = await this.gamification.grantReward({
          userId: row.referrerId,
          baseXp: reward.xp,
          baseCoins: reward.coins,
          xpSource: 'REFERRAL',
          coinSource: 'REFERRAL',
          refType: 'referral',
          refId: row.refereeId,
          idempotencyKey: referralRewardKey(row.refereeId),
          flat: true,
        });
        if (res.xp > 0 || res.coins > 0) rewarded += 1;
      } catch (err) {
        this.logger.warn(
          `referral reward for referee ${row.refereeId} failed: ${(err as Error).message}`,
        );
      }
    }
    return { candidates: rows.length, rewarded };
  }

  /** Job entry point (no-op under jest or with JOBS_ENABLED=false). */
  @Cron(ENGAGEMENT_CRONS.referralRewards, {
    name: 'runScheduledRewards',
    timeZone: 'UTC',
  })
  async runScheduledRewards(): Promise<ReferralRewardRun | null> {
    if (!jobsEnabled()) return null;
    const res = await this.grantPendingRewards();
    if (res.candidates > 0) {
      this.logger.log(
        `referral rewards: ${res.rewarded}/${res.candidates} paid`,
      );
    }
    return res;
  }
}

function newReferralCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}
