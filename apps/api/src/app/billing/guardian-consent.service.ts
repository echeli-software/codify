import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ageGroup } from '@codify/domain';
import { EmailService, isDeliverableAddress } from '../email/email.service.js';
import { RateLimitedException } from '../exercises/rate-limit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AGE_SELECT } from '../users/age-policy.js';
import { guardianNoticeEmail } from './guardian-consent-email.js';

/** A confirmation covers checkouts of that plan price for this long. */
export const GUARDIAN_CONSENT_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many confirmations per user per TTL window (each emails someone). */
export const GUARDIAN_CONSENT_MAX_PER_DAY = 5;
/** `GuardianConsent.purpose` for web checkout. */
export const GUARDIAN_PURPOSE_CHECKOUT = 'web_checkout';

/** `POST /api/billing/guardian-consent`. */
export class GuardianConsentDto {
  @IsString()
  @Length(1, 100)
  planPriceId!: string;

  @IsString()
  @Length(2, 120)
  guardianName!: string;

  @IsEmail()
  @MaxLength(254)
  guardianEmail!: string;

  /** The tick box: "I am 18 or older and this user's parent or guardian". */
  @IsBoolean()
  @Equals(true, { message: 'confirmed must be true' })
  confirmed!: boolean;
}

export interface GuardianConsentView {
  id: string;
  planPriceId: string | null;
  guardianName: string;
  confirmedAt: string;
  /** Checkout of this plan price is allowed until then. */
  validUntil: string;
  /** The guardian's notice was handed to the email provider. */
  noticeSent: boolean;
}

export interface GuardianConsentStatus {
  /** True when this caller must confirm a guardian before checkout. */
  required: boolean;
  ageGroup: 'minor' | 'adult' | null;
  /** The recent confirmation for this plan price, if any. */
  consent: Omit<GuardianConsentView, 'noticeSent'> | null;
}

export interface ConsentRequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Parent / guardian step for minors' paid plans on the web (docs/09
 * "Guardian step", launch decision 2026-11). A minor's web checkout needs
 * a `GuardianConsent` for that plan price from the last 24 h; the guardian
 * gets a one-off notice by email in the student's locale. Adults never
 * need one; an account with no date of birth must give it first (403
 * `BIRTH_DATE_REQUIRED`). Store purchases rely on the stores' family
 * controls and do not come through here.
 */
@Injectable()
export class GuardianConsentService {
  private readonly logger = new Logger(GuardianConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async status(
    userId: string,
    planPriceId: string,
    now = new Date(),
  ): Promise<GuardianConsentStatus> {
    const group = await this.ageGroupOf(userId, now);
    const consent =
      group === 'minor' ? await this.recent(userId, planPriceId, now) : null;
    return {
      required: group !== 'adult' && !consent,
      ageGroup: group,
      consent: consent ? toView(consent) : null,
    };
  }

  /** Record a confirmation and email the guardian. */
  async record(
    userId: string,
    dto: GuardianConsentDto,
    meta: ConsentRequestMeta,
    now = new Date(),
  ): Promise<GuardianConsentView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...AGE_SELECT, email: true, displayName: true, locale: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const group = ageGroup(user, now);
    if (group === null) throw birthDateRequired();
    if (group === 'adult')
      throw new ConflictException({
        code: 'GUARDIAN_CONSENT_NOT_NEEDED',
        message: 'Adults do not need a parent or guardian confirmation',
      });
    const guardianEmail = dto.guardianEmail.trim().toLowerCase();
    if (guardianEmail === user.email.toLowerCase())
      throw new BadRequestException({
        code: 'GUARDIAN_EMAIL_IS_STUDENT',
        message: "Enter your parent or guardian's email, not your own",
      });
    const price = await this.prisma.planPrice.findUnique({
      where: { id: dto.planPriceId },
      include: { plan: true },
    });
    if (
      !price ||
      !price.isActive ||
      price.plan.deletedAt ||
      !price.plan.isActive
    )
      throw new NotFoundException('Plan price not found');

    const since = new Date(now.getTime() - GUARDIAN_CONSENT_TTL_MS);
    const recentCount = await this.prisma.guardianConsent.count({
      where: { userId, confirmedAt: { gte: since } },
    });
    if (recentCount >= GUARDIAN_CONSENT_MAX_PER_DAY)
      throw new RateLimitedException(
        'Too many guardian confirmations today — try again tomorrow',
        Math.ceil(GUARDIAN_CONSENT_TTL_MS / 1000),
        'GUARDIAN_CONSENT_RATE_LIMITED',
      );

    const guardianName = dto.guardianName.replace(/\s+/g, ' ').trim();
    const row = await this.prisma.guardianConsent.create({
      data: {
        userId,
        guardianName,
        guardianEmail,
        purpose: GUARDIAN_PURPOSE_CHECKOUT,
        planPriceId: price.id,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        confirmedAt: now,
      },
    });

    let noticeSent = false;
    if (isDeliverableAddress(guardianEmail)) {
      try {
        await this.email.sendNotice(
          guardianEmail,
          guardianNoticeEmail({
            locale: user.locale,
            guardianName,
            studentName: user.displayName,
            planName: price.plan.name,
            currency: price.currency,
            amountCents: price.amountCents,
            period: price.period,
          }),
        );
        noticeSent = true;
      } catch (err) {
        // The confirmation stands; the notice failing is logged (not the address).
        this.logger.warn(
          `Guardian notice for consent ${row.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return { ...toView(row), noticeSent };
  }

  /**
   * Checkout gate: adults pass; a minor needs a confirmation for this plan
   * price from the last 24 h (403 `GUARDIAN_CONSENT_REQUIRED`); no date of
   * birth is 403 `BIRTH_DATE_REQUIRED`.
   */
  async assertCheckoutAllowed(
    userId: string,
    planPriceId: string,
    now = new Date(),
  ): Promise<void> {
    const group = await this.ageGroupOf(userId, now);
    if (group === 'adult') return;
    if (group === null) throw birthDateRequired();
    if (await this.recent(userId, planPriceId, now)) return;
    throw new ForbiddenException({
      code: 'GUARDIAN_CONSENT_REQUIRED',
      message:
        'A parent or guardian must confirm this plan before checkout (users aged 12–17)',
      planPriceId,
    });
  }

  private async ageGroupOf(userId: string, now: Date) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: AGE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return ageGroup(user, now);
  }

  private recent(userId: string, planPriceId: string, now: Date) {
    return this.prisma.guardianConsent.findFirst({
      where: {
        userId,
        planPriceId,
        purpose: GUARDIAN_PURPOSE_CHECKOUT,
        confirmedAt: { gte: new Date(now.getTime() - GUARDIAN_CONSENT_TTL_MS) },
      },
      orderBy: { confirmedAt: 'desc' },
    });
  }
}

function birthDateRequired(): ForbiddenException {
  return new ForbiddenException({
    code: 'BIRTH_DATE_REQUIRED',
    message: 'Add your date of birth before buying a plan',
  });
}

function toView(row: {
  id: string;
  planPriceId: string | null;
  guardianName: string;
  confirmedAt: Date;
}): Omit<GuardianConsentView, 'noticeSent'> {
  return {
    id: row.id,
    planPriceId: row.planPriceId,
    guardianName: row.guardianName,
    confirmedAt: row.confirmedAt.toISOString(),
    validUntil: new Date(
      row.confirmedAt.getTime() + GUARDIAN_CONSENT_TTL_MS,
    ).toISOString(),
  };
}
