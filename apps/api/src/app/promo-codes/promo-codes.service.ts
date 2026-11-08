import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PromoCode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { GamificationService } from '../gamification/gamification.service.js';
import {
  PROMO_CODE_PATTERN,
  type CreatePromoCodeDto,
  type PromoCodeView,
  type RedeemPromoCodeResponse,
  type UpdatePromoCodeDto,
} from './promo-codes.dto.js';

/** Failed redemptions allowed per user per hour (code guessing guard). */
export const PROMO_FAILURES_PER_HOUR = 10;
const FAIL_SCOPE = 'promo_redeem_fail';

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isRedeemableNow(p: PromoCode, now = new Date()): boolean {
  return (
    p.isActive &&
    (!p.startsAt || p.startsAt <= now) &&
    (!p.endsAt || p.endsAt > now) &&
    (p.maxRedemptions == null || p.redemptions < p.maxRedemptions)
  );
}

function toView(p: PromoCode, now = new Date()): PromoCodeView {
  return {
    id: p.id,
    code: p.code,
    coins: p.coins,
    maxRedemptions: p.maxRedemptions,
    redemptions: p.redemptions,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    isActive: p.isActive,
    description: p.description,
    redeemableNow: isRedeemableNow(p, now),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function problem(status: HttpStatus, code: string, message: string) {
  return new HttpException({ statusCode: status, code, message }, status);
}

/**
 * Coin promo codes (docs/08 §12): admins create codes worth N coins with an
 * optional window and redemption limit; a student redeems a code once
 * (case-insensitive) and the coins land as a PROMO_CODE ledger row through
 * the reward pipeline. Failed attempts are counted per user (10 / hour) on
 * top of the reward throttle, so codes can't be brute-forced.
 */
@Injectable()
export class PromoCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  // ─── Admin ──────────────────────────────────────────────────────────────

  async list(): Promise<PromoCodeView[]> {
    const rows = await this.prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const now = new Date();
    return rows.map((r) => toView(r, now));
  }

  async create(input: CreatePromoCodeDto): Promise<PromoCodeView> {
    const code = normalizePromoCode(input.code);
    this.assertWindow(input.startsAt ?? null, input.endsAt ?? null);
    try {
      const row = await this.prisma.promoCode.create({
        data: {
          code,
          coins: input.coins,
          maxRedemptions: input.maxRedemptions ?? null,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          isActive: input.isActive ?? true,
          description: input.description ?? null,
        },
      });
      return toView(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException({
          code: 'PROMO_CODE_TAKEN',
          message: `Promo code ${code} already exists`,
        });
      throw err;
    }
  }

  async update(id: string, patch: UpdatePromoCodeDto): Promise<PromoCodeView> {
    const current = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Promo code not found');
    const date = (v: string | null | undefined, cur: Date | null) =>
      v === undefined ? cur : v ? new Date(v) : null;
    const startsAt = date(patch.startsAt, current.startsAt);
    const endsAt = date(patch.endsAt, current.endsAt);
    this.assertWindow(startsAt, endsAt);
    const row = await this.prisma.promoCode.update({
      where: { id },
      data: {
        coins: patch.coins,
        maxRedemptions:
          patch.maxRedemptions === undefined ? undefined : patch.maxRedemptions,
        startsAt,
        endsAt,
        isActive: patch.isActive,
        description:
          patch.description === undefined ? undefined : patch.description,
      },
    });
    return toView(row);
  }

  /** Delete an unused code; a redeemed one is deactivated (history kept). */
  async remove(id: string): Promise<{ deleted: boolean }> {
    const current = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Promo code not found');
    if (current.redemptions > 0) {
      await this.prisma.promoCode.update({
        where: { id },
        data: { isActive: false },
      });
      return { deleted: false };
    }
    await this.prisma.promoCode.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Student ────────────────────────────────────────────────────────────

  async redeem(
    userId: string,
    rawCode: string,
    now: Date = new Date(),
  ): Promise<RedeemPromoCodeResponse> {
    const failures = await this.prisma.idempotencyRecord.count({
      where: {
        scope: FAIL_SCOPE,
        userId,
        createdAt: { gte: new Date(now.getTime() - 3_600_000) },
      },
    });
    if (failures >= PROMO_FAILURES_PER_HOUR) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'PROMO_CODE_RATE_LIMITED',
          message: 'Too many attempts — try again in an hour',
          retryAfter: 3600,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = normalizePromoCode(rawCode);
    try {
      if (!PROMO_CODE_PATTERN.test(code))
        throw problem(
          HttpStatus.NOT_FOUND,
          'PROMO_CODE_NOT_FOUND',
          'This code is not valid',
        );
      return await this.redeemValid(userId, code, now);
    } catch (err) {
      if (
        err instanceof HttpException &&
        [
          'PROMO_CODE_NOT_FOUND',
          'PROMO_CODE_NOT_STARTED',
          'PROMO_CODE_EXPIRED',
        ].includes(
          (err.getResponse() as { code?: string } | undefined)?.code ?? '',
        )
      ) {
        await this.prisma.idempotencyRecord.create({
          data: {
            key: `${FAIL_SCOPE}:${userId}:${randomUUID()}`,
            scope: FAIL_SCOPE,
            userId,
          },
        });
      }
      throw err;
    }
  }

  private async redeemValid(
    userId: string,
    code: string,
    now: Date,
  ): Promise<RedeemPromoCodeResponse> {
    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!promo || !promo.isActive)
      throw problem(
        HttpStatus.NOT_FOUND,
        'PROMO_CODE_NOT_FOUND',
        'This code is not valid',
      );
    if (promo.startsAt && promo.startsAt > now)
      throw problem(
        HttpStatus.BAD_REQUEST,
        'PROMO_CODE_NOT_STARTED',
        'This code is not active yet',
      );
    if (promo.endsAt && promo.endsAt <= now)
      throw problem(
        HttpStatus.GONE,
        'PROMO_CODE_EXPIRED',
        'This code has expired',
      );
    const already = await this.prisma.promoCodeRedemption.findUnique({
      where: { promoCodeId_userId: { promoCodeId: promo.id, userId } },
      select: { promoCodeId: true },
    });
    if (already)
      throw problem(
        HttpStatus.CONFLICT,
        'PROMO_CODE_ALREADY_REDEEMED',
        'You already redeemed this code',
      );

    try {
      return await this.prisma.$transaction(async (tx) => {
        // The (promoCodeId, userId) primary key is the once-per-user guard.
        await tx.promoCodeRedemption.create({
          data: { promoCodeId: promo.id, userId },
        });
        // Conditional increment: the redemption limit holds under races.
        const bumped =
          promo.maxRedemptions == null
            ? await tx.promoCode.updateMany({
                where: { id: promo.id },
                data: { redemptions: { increment: 1 } },
              })
            : await tx.promoCode.updateMany({
                where: {
                  id: promo.id,
                  redemptions: { lt: promo.maxRedemptions },
                },
                data: { redemptions: { increment: 1 } },
              });
        if (bumped.count === 0)
          throw problem(
            HttpStatus.CONFLICT,
            'PROMO_CODE_EXHAUSTED',
            'This code has been fully redeemed',
          );
        const reward = await this.gamification.grantReward(
          {
            userId,
            baseXp: 0,
            baseCoins: promo.coins,
            xpSource: 'ADMIN_GRANT',
            coinSource: 'PROMO_CODE',
            refType: 'promo_code',
            refId: promo.id,
            idempotencyKey: `promo_code:${promo.id}:${userId}`,
            flat: true,
            uncapped: true,
          },
          tx,
        );
        return { code: promo.code, coins: reward.coins, totals: reward.totals };
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw problem(
          HttpStatus.CONFLICT,
          'PROMO_CODE_ALREADY_REDEEMED',
          'You already redeemed this code',
        );
      throw err;
    }
  }

  private assertWindow(
    startsAt: string | Date | null,
    endsAt: string | Date | null,
  ): void {
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))
      throw new BadRequestException({
        code: 'PROMO_CODE_WINDOW',
        message: 'endsAt must be after startsAt',
      });
  }
}
