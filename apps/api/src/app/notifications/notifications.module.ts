import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../common/queue.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { DevicesService } from './devices.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsScheduler } from './notifications.scheduler.js';
import { PUSH_PROVIDER } from './push.provider.js';
import { createPushProvider } from './push-provider.factory.js';
import { PushService } from './push.service.js';
import { PUSH_DEFERRED_QUEUE, PUSH_DEFERRER } from './push-deferral.js';
import { BullPushDeferrer } from './bull-push-deferrer.js';
import { PushDeferredProcessor } from './push-deferred.processor.js';
import { StreakReminderService } from './streak-reminder.service.js';

/**
 * Notifications: device-token registry, push delivery (`PushService` —
 * the API other modules use, with quiet-hours deferral on the
 * `push-deferred` BullMQ queue and Redis-tracked caps), streak reminders +
 * their hourly cron.
 */
@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: PUSH_DEFERRED_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers: [
    DevicesService,
    PushService,
    PushDeferredProcessor,
    { provide: PUSH_DEFERRER, useClass: BullPushDeferrer },
    StreakReminderService,
    NotificationsScheduler,
    {
      provide: PUSH_PROVIDER,
      inject: [AppConfigService],
      useFactory: createPushProvider,
    },
  ],
  exports: [DevicesService, PushService, StreakReminderService, PUSH_PROVIDER],
})
export class NotificationsModule {}
