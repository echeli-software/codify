import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AccessService } from './access.service.js';
import { BillingService } from './billing.service.js';
import { BillingAdminService } from './billing-admin.service.js';
import {
  AdminCancelSubscriptionDto,
  ChangeSubscriptionDto,
  CompleteDevCheckoutDto,
  CreateCheckoutDto,
  GrantSubscriptionDto,
  PortalSessionDto,
  type AdminSubscriptionListResponse,
  type AdminSubscriptionResponse,
  type CheckoutSessionResponse,
  type MySubscriptionResponse,
  type PortalResponse,
  type SubscriptionResponse,
} from './billing.dto.js';
import type { AccessResult } from '@codify/domain';

function reqMeta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Student-facing billing surface: start a checkout, open the customer
 * portal, read current subscription state, cancel / resume, and query
 * lesson access (so the paywall sheet can show required plans).
 * `dev/complete-checkout` is the local stand-in for Stripe webhooks while
 * running without Stripe keys.
 */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly admin: BillingAdminService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Roles('STUDENT')
  @Post('checkout-session')
  @HttpCode(200)
  async checkout(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateCheckoutDto,
    @Req() req: Request,
  ): Promise<CheckoutSessionResponse> {
    const session = await this.billing.createCheckout(actor, body);
    void this.audit.record(actor, {
      action: 'billing.checkout.start',
      entity: 'PlanPrice',
      entityId: body.planPriceId,
      diff: { paymentMethod: body.paymentMethod ?? 'card', mode: session.mode },
      ...reqMeta(req),
    });
    return session;
  }

  @Roles('STUDENT')
  @Post('portal-session')
  @HttpCode(200)
  portal(
    @CurrentUser() actor: ApiUser,
    @Body() body: PortalSessionDto,
  ): Promise<PortalResponse> {
    return this.billing.createPortal(actor, body.returnUrl);
  }

  @Roles('STUDENT')
  @Get('subscription')
  mySubscription(
    @CurrentUser() actor: ApiUser,
  ): Promise<MySubscriptionResponse> {
    return this.billing.getMySubscriptions(actor);
  }

  /** Cancel at period end (docs/09 §5): access continues until currentPeriodEnd. */
  @Roles('STUDENT')
  @Post('subscription/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() actor: ApiUser,
    @Body() body: ChangeSubscriptionDto,
    @Req() req: Request,
  ): Promise<SubscriptionResponse> {
    const sub = await this.billing.cancelMine(actor, body);
    void this.audit.record(actor, {
      action: 'billing.subscription.cancel',
      entity: 'Subscription',
      entityId: sub.id,
      diff: { cancelAtPeriodEnd: true, reason: body.reason ?? null },
      ...reqMeta(req),
    });
    return sub;
  }

  @Roles('STUDENT')
  @Post('subscription/resume')
  @HttpCode(200)
  async resume(
    @CurrentUser() actor: ApiUser,
    @Body() body: ChangeSubscriptionDto,
    @Req() req: Request,
  ): Promise<SubscriptionResponse> {
    const sub = await this.billing.resumeMine(actor, body);
    void this.audit.record(actor, {
      action: 'billing.subscription.resume',
      entity: 'Subscription',
      entityId: sub.id,
      diff: { cancelAtPeriodEnd: false },
      ...reqMeta(req),
    });
    return sub;
  }

  @Roles('STUDENT')
  @Get('access/lesson/:id')
  async lessonAccess(
    @CurrentUser() actor: ApiUser,
    @Param('id') lessonId: string,
  ): Promise<AccessResult> {
    const { access } = await this.access.resolveLessonAccess(
      actor.userId,
      lessonId,
    );
    return access;
  }

  @Roles('STUDENT')
  @Post('dev/complete-checkout')
  @HttpCode(201)
  async completeDev(
    @CurrentUser() actor: ApiUser,
    @Body() body: CompleteDevCheckoutDto,
    @Req() req: Request,
  ): Promise<SubscriptionResponse> {
    const sub = await this.billing.completeDevCheckout(actor, body.sessionId);
    void this.audit.record(actor, {
      action: 'billing.checkout.dev_complete',
      entity: 'Subscription',
      entityId: sub.id,
      diff: { planId: sub.planId, status: sub.status },
      ...reqMeta(req),
    });
    return sub;
  }

  // ─── Support / admin ────────────────────────────────────────────────

  @Roles('SUPPORT', 'ADMIN')
  @Get('admin/users/:userId/subscriptions')
  userSubscriptions(
    @Param('userId') userId: string,
  ): Promise<AdminSubscriptionListResponse> {
    return this.admin.listForUser(userId);
  }

  @Roles('SUPPORT', 'ADMIN')
  @Post('admin/users/:userId/grant')
  @HttpCode(201)
  async grant(
    @CurrentUser() actor: ApiUser,
    @Param('userId') userId: string,
    @Body() body: GrantSubscriptionDto,
    @Req() req: Request,
  ): Promise<AdminSubscriptionResponse> {
    const sub = await this.admin.grant(actor, userId, body);
    void this.audit.record(actor, {
      action: 'billing.subscription.grant',
      entity: 'Subscription',
      entityId: sub.id,
      diff: {
        userId,
        planId: body.planId,
        durationDays: body.durationDays,
        currentPeriodEnd: sub.currentPeriodEnd,
        reason: body.reason ?? null,
      },
      ...reqMeta(req),
    });
    return sub;
  }

  @Roles('SUPPORT', 'ADMIN')
  @Post('admin/subscriptions/:id/cancel')
  @HttpCode(200)
  async adminCancel(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: AdminCancelSubscriptionDto,
    @Req() req: Request,
  ): Promise<AdminSubscriptionResponse> {
    const sub = await this.admin.cancel(id, body);
    void this.audit.record(actor, {
      action: 'billing.subscription.admin_cancel',
      entity: 'Subscription',
      entityId: sub.id,
      diff: {
        userId: sub.userId,
        mode: body.mode,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        reason: body.reason ?? null,
      },
      ...reqMeta(req),
    });
    return sub;
  }
}
