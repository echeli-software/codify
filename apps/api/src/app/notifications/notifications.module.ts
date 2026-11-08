import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../common/queue.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { EmailModule } from '../email/email.module.js';
import { DevicesService } from './devices.service.js';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';
import { NotificationService } from './notification.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsScheduler } from './notifications.scheduler.js';
import { PUSH_PROVIDER } from './push.provider.js';
import { createPushProvider } from './push-provider.factory.js';
import { PushService } from './push.service.js';
import { PUSH_DEFERRED_QUEUE, PUSH_DEFERRER } from './push-deferral.js';
import { BullPushDeferrer } from './bull-push-deferrer.js';
import { PushDeferredProcessor } from './push-deferred.processor.js';
import { StreakReminderService } from './streak-reminder.service.js';
import { WebPushController } from './web-push.controller.js';
import {
  WEB_PUSH_PROVIDER,
  createWebPushProvider,
} from './web-push.provider.js';
import { WebPushSubscriptionsService } from './web-push-subscriptions.service.js';

/**
 * Notifications: `NotificationService.notify` (the entry point — inbox row
 * + push + email), the student inbox / preferences API, device-token
 * registry, push delivery (`PushService` — delivery rules, quiet-hours
 * deferral on the `push-deferred` BullMQ queue, Redis-tracked caps),
 * streak reminders + their hourly cron, browser web push (VAPID
 * subscriptions, delivered by PushService next to the native tokens).
 */
@Module({
  imports: [
    QueueModule,
    EmailModule,
    BullModule.registerQueue({ name: PUSH_DEFERRED_QUEUE }),
  ],
  controllers: [NotificationsController, InboxController, WebPushController],
  providers: [
    DevicesService,
    PushService,
    NotificationService,
    InboxService,
    PushDeferredProcessor,
    { provide: PUSH_DEFERRER, useClass: BullPushDeferrer },
    StreakReminderService,
    NotificationsScheduler,
    WebPushSubscriptionsService,
    { provide: WEB_PUSH_PROVIDER, useFactory: () => createWebPushProvider() },
    {
      provide: PUSH_PROVIDER,
      inject: [AppConfigService],
      useFactory: createPushProvider,
    },
  ],
  exports: [
    DevicesService,
    PushService,
    NotificationService,
    StreakReminderService,
    PUSH_PROVIDER,
    WEB_PUSH_PROVIDER,
    EmailModule,
  ],
})
export class NotificationsModule {}
