import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { WebPushSubscribeDto, WebPushUnsubscribeDto } from './web-push.dto.js';
import { WEB_PUSH_PROVIDER, WebPushProvider } from './web-push.provider.js';
import { WebPushSubscriptionsService } from './web-push-subscriptions.service.js';

/**
 * Web push for the student PWA (docs/10 §3 Channels):
 *
 *   GET    /push/web/config          public — `{ publicKey }`, 404
 *                                    WEB_PUSH_DISABLED without VAPID keys
 *   POST   /push/web/subscriptions   `{ endpoint, keys: { p256dh, auth } }`
 *                                    upsert by endpoint, bound to the caller
 *   DELETE /push/web/subscriptions   `{ endpoint }` — the caller's own only
 */
@Controller('push/web')
export class WebPushController {
  constructor(
    private readonly subscriptions: WebPushSubscriptionsService,
    @Inject(WEB_PUSH_PROVIDER) private readonly provider: WebPushProvider,
  ) {}

  @Public()
  @Get('config')
  config(): { publicKey: string } {
    const publicKey = this.provider.publicKey;
    if (!publicKey) {
      throw new NotFoundException({
        code: 'WEB_PUSH_DISABLED',
        message: 'Web push is not configured on this server',
      });
    }
    return { publicKey };
  }

  @Post('subscriptions')
  async subscribe(
    @CurrentUser() actor: ApiUser,
    @Body() body: WebPushSubscribeDto,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    if (!this.provider.enabled) {
      throw new NotFoundException({
        code: 'WEB_PUSH_DISABLED',
        message: 'Web push is not configured on this server',
      });
    }
    const ua = req.headers['user-agent'];
    return this.subscriptions.subscribe(actor.userId, {
      endpoint: body.endpoint,
      keys: body.keys,
      userAgent: typeof ua === 'string' ? ua : null,
    });
  }

  @Delete('subscriptions')
  @HttpCode(200)
  unsubscribe(
    @CurrentUser() actor: ApiUser,
    @Body() body: WebPushUnsubscribeDto,
  ): Promise<{ removed: number }> {
    return this.subscriptions.unsubscribe(actor.userId, body.endpoint);
  }
}
