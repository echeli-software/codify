import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  InboxQueryDto,
  UpdateNotificationPreferencesDto,
  type InboxItem,
  type InboxPage,
  type NotificationPreferencesView,
} from './inbox.dto.js';
import { InboxService } from './inbox.service.js';

/**
 * The signed-in user's notification inbox + preferences (docs/05
 * Notifications bell / Settings → Notifications, docs/10 §3). Any
 * authenticated role; every route is scoped to the caller's own rows.
 *
 *   GET  /me/notifications?cursor=&limit=     newest first, cursor-paginated
 *   GET  /me/notifications/unread-count
 *   POST /me/notifications/read-all
 *   POST /me/notifications/:id/read
 *   POST /me/notifications/:id/fewer           "fewer like this"
 *   GET  /me/notification-preferences
 *   PUT  /me/notification-preferences
 */
@Controller('me')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('notifications')
  list(
    @CurrentUser() actor: ApiUser,
    @Query() q: InboxQueryDto,
  ): Promise<InboxPage> {
    return this.inbox.list(actor.userId, q.cursor, q.limit);
  }

  @Get('notifications/unread-count')
  unread(@CurrentUser() actor: ApiUser): Promise<{ count: number }> {
    return this.inbox.unreadCount(actor.userId);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() actor: ApiUser): Promise<{ updated: number }> {
    return this.inbox.markAllRead(actor.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InboxItem> {
    return this.inbox.markRead(actor.userId, id);
  }

  @Post('notifications/:id/fewer')
  @HttpCode(200)
  fewer(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.inbox.fewer(actor.userId, id);
  }

  @Get('notification-preferences')
  preferences(
    @CurrentUser() actor: ApiUser,
  ): Promise<NotificationPreferencesView> {
    return this.inbox.preferences(actor.userId);
  }

  @Put('notification-preferences')
  update(
    @CurrentUser() actor: ApiUser,
    @Body() body: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesView> {
    return this.inbox.updatePreferences(actor.userId, body);
  }
}
