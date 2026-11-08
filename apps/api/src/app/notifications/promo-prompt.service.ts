import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { canReceiveMarketing } from './marketing-audience.js';

export interface PromoPromptState {
  /** Show the one-time "Get alerts about bonus events?" card now. */
  show: boolean;
  /** When the user answered (whatever the answer), or null. */
  promptedAt: string | null;
}

export interface PromoPromptAnswer {
  promptedAt: string;
  push: boolean;
  email: boolean;
}

/**
 * The one-time promotional-alerts prompt (launch decision 2026-11,
 * docs/10 §3): after the first completed lesson, adults only, ask once
 * whether to get alerts about bonus events. Accepting turns PROMO push on;
 * its own tick box turns on marketing email (`User.marketingEmailOptIn` +
 * PROMO email). `User.promoPromptedAt` is stamped whatever the answer, so
 * it is never asked again. Minors and users whose age is unknown are never
 * asked (fail closed).
 */
@Injectable()
export class PromoPromptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async state(
    userId: string,
    now: Date = new Date(),
  ): Promise<PromoPromptState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        birthDate: true,
        timezone: true,
        promoPromptedAt: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    const promptedAt = user.promoPromptedAt?.toISOString() ?? null;
    if (promptedAt || !canReceiveMarketing(user, now))
      return { show: false, promptedAt };
    const lesson = await this.prisma.progress.findFirst({
      where: { userId },
      select: { id: true },
    });
    return { show: lesson !== null, promptedAt };
  }

  async answer(
    actor: ApiUser,
    answer: { push: boolean; email: boolean },
    now: Date = new Date(),
  ): Promise<PromoPromptAnswer> {
    const userId = actor.userId;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true, timezone: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    if (!canReceiveMarketing(user, now)) {
      throw new ForbiddenException({
        code: 'PROMO_PROMPT_NOT_ALLOWED',
        message: 'Promotional alerts are for adults only',
      });
    }
    const { push, email } = answer;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id: userId, promoPromptedAt: null },
        data: {
          promoPromptedAt: now,
          // Explicit consent only ever turns marketing email on here.
          ...(email ? { marketingEmailOptIn: true } : {}),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'PROMO_PROMPT_ANSWERED',
          message: 'The promotional alerts prompt was already answered',
        });
      }
      // The answer is about promotions: a "no" also turns PROMO email off.
      await tx.notificationPreference.upsert({
        where: { userId_kind: { userId, kind: 'PROMO' } },
        create: {
          userId,
          kind: 'PROMO',
          pushEnabled: push,
          emailEnabled: email,
        },
        update: { pushEnabled: push, emailEnabled: email },
      });
    });
    void this.audit.record(actor, {
      action: 'user.promo_prompt_answered',
      entity: 'User',
      entityId: userId,
      diff: { push, email },
    });
    return { promptedAt: now.toISOString(), push, email };
  }
}
