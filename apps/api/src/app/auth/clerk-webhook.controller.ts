import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { NoThrottle } from '../common/throttling/throttle.decorators.js';
import { ClerkService } from './clerk.service.js';
import {
  ClerkWebhookService,
  type ClerkWebhookResult,
} from './clerk-webhook.service.js';
import { Public } from './public.decorator.js';

/**
 * `POST /api/webhooks/clerk` — Clerk user/session lifecycle events.
 * Public (Clerk can't send a bearer token) but every delivery must carry a
 * valid Svix signature over the raw body (docs/14 §6). Exempt from rate
 * limiting: Clerk retries with backoff and bursts on bulk changes.
 */
@Controller('webhooks/clerk')
@Public()
@NoThrottle()
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  constructor(
    private readonly clerk: ClerkService,
    private readonly webhooks: ClerkWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<ClerkWebhookResult> {
    if (!this.clerk.webhooksEnabled) {
      throw new ServiceUnavailableException(
        'Clerk webhooks are not configured',
      );
    }
    const deliveryId = req.headers['svix-id'];
    if (!req.rawBody || typeof deliveryId !== 'string' || !deliveryId) {
      throw new BadRequestException('Missing webhook body or svix headers');
    }
    let event: { type: string; data: Record<string, unknown> };
    try {
      event = await this.clerk.verifyWebhook(req.rawBody, req.headers);
    } catch (err) {
      this.logger.warn(
        `Rejected Clerk webhook ${deliveryId}: ${(err as Error).message}`,
      );
      throw new BadRequestException({
        message: 'Invalid webhook signature',
        code: 'webhook.invalid_signature',
      });
    }
    return this.webhooks.handle(deliveryId, event);
  }
}
