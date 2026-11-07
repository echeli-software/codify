import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AccessService } from './access.service.js';
import { BillingService, assertWebManaged } from './billing.service.js';
import type {
  AdminCancelSubscriptionDto,
  AdminSubscriptionListResponse,
  AdminSubscriptionResponse,
  GrantSubscriptionDto,
} from './billing.dto.js';
import { addDays, toAdminSubscriptionResponse } from './subscription-view.js';

/** docs/14 §2: SUPPORT can't give away more than ~1 month of subscription. */
export const SUPPORT_MAX_GRANT_DAYS = 31;

/**
 * Support / admin subscription tooling: inspect a user's subscriptions,
 * grant a plan for a fixed period (ADMIN_GRANT, non-renewing), and cancel
 * a subscription immediately or at period end. Controllers audit-log every
 * mutation.
 */
@Injectable()
export class BillingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly billing: BillingService,
  ) {}

  async listForUser(userId: string): Promise<AdminSubscriptionListResponse> {
    await this.assertUser(userId);
    const [subs, grace] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { userId },
        include: { plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.access.pastDueGraceDays(),
    ]);
    const now = new Date();
    return {
      subscriptions: subs.map((s) =>
        toAdminSubscriptionResponse(s, s.plan.name, now, grace),
      ),
    };
  }

  async grant(
    actor: ApiUser,
    userId: string,
    dto: GrantSubscriptionDto,
  ): Promise<AdminSubscriptionResponse> {
    if (actor.role !== 'ADMIN' && dto.durationDays > SUPPORT_MAX_GRANT_DAYS) {
      throw new ForbiddenException(
        `Support can grant at most ${SUPPORT_MAX_GRANT_DAYS} days; ask an admin for longer grants`,
      );
    }
    await this.assertUser(userId);
    const plan = await this.prisma.plan.findFirst({
      where: { id: dto.planId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const now = new Date();
    const sub = await this.prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        source: 'ADMIN_GRANT',
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: addDays(now, dto.durationDays),
        // A grant never renews: access ends with the granted period.
        cancelAtPeriodEnd: true,
      },
    });
    return this.view(sub, plan.name);
  }

  async cancel(
    subscriptionId: string,
    dto: AdminCancelSubscriptionDto,
  ): Promise<AdminSubscriptionResponse> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: { select: { name: true } } },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    // Store subscriptions would be revived by the next store renewal event;
    // they must be refunded / canceled in the store console.
    assertWebManaged(sub);
    if (sub.status === 'CANCELED')
      throw new ConflictException('Subscription is already canceled');
    if (dto.mode !== 'immediate' && dto.mode !== 'period_end') {
      throw new BadRequestException('mode must be immediate or period_end');
    }

    const updated =
      dto.mode === 'immediate'
        ? await this.billing.endNow(sub)
        : sub.cancelAtPeriodEnd
          ? sub
          : await this.billing.setCancelAtPeriodEnd(sub, true);
    return this.view(updated, sub.plan.name);
  }

  private async view(
    sub: Subscription,
    planName: string,
  ): Promise<AdminSubscriptionResponse> {
    return toAdminSubscriptionResponse(
      sub,
      planName,
      new Date(),
      await this.access.pastDueGraceDays(),
    );
  }

  private async assertUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }
}
