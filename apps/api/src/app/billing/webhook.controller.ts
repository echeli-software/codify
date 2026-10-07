import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { WebhookService } from './webhook.service.js';
import { RevenueCatWebhookService } from './revenuecat-webhook.service.js';
import type { WebhookResult } from './webhook-idempotency.js';

type RawRequest = Request & { rawBody?: Buffer };

/**
 * Store webhook receivers. Both are public (the stores call them
 * unauthenticated by our session) — security comes from per-provider
 * verification: the Stripe signature for /stripe (over the exact raw bytes,
 * `req.rawBody`, which needs `rawBody: true` on the Nest app), the
 * configured Authorization secret for /revenuecat.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly revenuecat: RevenueCatWebhookService,
  ) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  stripe(
    @Body() body: unknown,
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: RawRequest,
  ): Promise<WebhookResult> {
    // Stripe mode 400s without req.rawBody; dev re-serializes the parsed body.
    return this.webhooks.handleStripe(req.rawBody, body, signature);
  }

  @Public()
  @Post('revenuecat')
  @HttpCode(200)
  revenuecatWebhook(
    @Body() body: unknown,
    @Headers('authorization') authHeader: string | undefined,
    @Req() req: RawRequest,
  ): Promise<WebhookResult> {
    const raw = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify(body ?? {});
    return this.revenuecat.handle(raw, authHeader);
  }
}
