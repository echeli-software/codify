import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { WebhookService } from './webhook.service.js';

/**
 * Stripe webhook receiver. Public (Stripe is unauthenticated) — security
 * comes from signature verification inside the provider.
 *
 * NOTE: real Stripe signature verification needs the *raw* request body.
 * Production wires an express.raw() middleware for this path and reads
 * `req.rawBody`; here (dev provider) we re-serialize the parsed body since
 * the dev provider doesn't verify signatures.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

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
}
