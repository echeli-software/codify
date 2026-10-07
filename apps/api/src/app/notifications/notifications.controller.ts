import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { DevicesService } from './devices.service.js';
import {
  StreakReminderService,
  type StreakReminderResult,
} from './streak-reminder.service.js';
import { RegisterDeviceDto } from './notifications.dto.js';
import {
  PUSH_PROVIDER,
  type PushProvider,
  DevPushProvider,
} from './push.provider.js';

@Controller()
export class NotificationsController {
  constructor(
    private readonly devices: DevicesService,
    private readonly reminders: StreakReminderService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  // ─── Device tokens (student app registers on login) ──────────────────────

  @Roles('STUDENT')
  @Post('devices')
  register(@CurrentUser() actor: ApiUser, @Body() body: RegisterDeviceDto) {
    return this.devices.register(actor.userId, body.token, body.platform);
  }

  @Roles('STUDENT')
  @Delete('devices/:token')
  unregister(@CurrentUser() actor: ApiUser, @Param('token') token: string) {
    return this.devices.unregister(actor.userId, token);
  }

  @Roles('STUDENT')
  @Get('devices')
  list(@CurrentUser() actor: ApiUser) {
    return this.devices.listTokens(actor.userId);
  }

  // ─── Streak reminders (cron in prod; admin-triggered here) ───────────────

  @Roles('ADMIN')
  @Post('notifications/streak-reminder/run')
  runStreakReminders(): Promise<StreakReminderResult> {
    return this.reminders.run({ mode: 'manual' });
  }

  /** Dev-only: inspect what the DevPushProvider captured (verification aid). */
  @Roles('ADMIN')
  @Get('notifications/dev/sent')
  devSent(@Query('token') token?: string) {
    if (this.push instanceof DevPushProvider) {
      return { mode: 'dev', messages: this.push.recent(token) };
    }
    return { mode: this.push.mode, messages: [] };
  }
}
