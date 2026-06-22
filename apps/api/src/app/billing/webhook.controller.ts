import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { WebhookService } from './webhook.service.js';
import { RevenueCatWebhookService } from './revenuecat-webhook.service.js';

/**
 * Store webhook receivers. Both are public (the stores call them
 * unauthenticated by our session) — security comes from per-provider
 * verification: Stripe signature for /stripe, the configured Authorization
 * secret for /revenuecat.
 *
 * NOTE: real Stripe signature verification needs the *raw* request body.
 * Production wires an express.raw() middleware for this path and reads
 * `req.rawBody`; here (dev provider) we re-serialize the parsed body since
 * the dev provider doesn't verify signatures.
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
  async stripe(
    @Body() body: unknown,
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: string | Buffer },
  ): Promise<{ received: boolean; duplicate: boolean; handled: boolean }> {
    const raw = req.rawBody
      ? req.rawBody.toString()
      : JSON.stringify(body ?? {});
    return this.webhooks.handleStripe(raw, signature);
  }

  @Public()
  @Post('revenuecat')
  @HttpCode(200)
  async revenuecatWebhook(
    @Body() body: unknown,
    @Headers('authorization') authHeader: string | undefined,
    @Req() req: Request & { rawBody?: string | Buffer },
  ): Promise<{ received: boolean; duplicate: boolean; handled: boolean }> {
    const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(body ?? {});
    return this.revenuecat.handle(raw, authHeader);
  }
}
