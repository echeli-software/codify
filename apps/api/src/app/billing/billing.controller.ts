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
import {
  CompleteDevCheckoutDto,
  CreateCheckoutDto,
  PortalSessionDto,
  type CheckoutSessionResponse,
  type MySubscriptionResponse,
  type PortalResponse,
  type SubscriptionResponse,
} from './billing.dto.js';
import type { AccessResult } from '@codify/domain';

/**
 * Student-facing billing surface: start a checkout, open the customer
 * portal, read current subscription state, and query lesson access (so the
 * paywall sheet can show required plans). `dev/complete-checkout` is the
 * local stand-in for Stripe webhooks while running without Stripe keys.
 */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
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
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
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
  mySubscription(@CurrentUser() actor: ApiUser): Promise<MySubscriptionResponse> {
    return this.billing.getMySubscriptions(actor);
  }

  @Roles('STUDENT')
  @Get('access/lesson/:id')
  async lessonAccess(
    @CurrentUser() actor: ApiUser,
    @Param('id') lessonId: string,
  ): Promise<AccessResult> {
    const { access } = await this.access.resolveLessonAccess(actor.userId, lessonId);
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
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return sub;
  }
}
