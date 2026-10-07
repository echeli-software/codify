import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { DevicesService } from './devices.service.js';
import { FcmPushProvider } from './fcm-push.provider.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsScheduler } from './notifications.scheduler.js';
import {
  DevPushProvider,
  PUSH_PROVIDER,
  type PushProvider,
} from './push.provider.js';
import { PushService } from './push.service.js';
import { StreakReminderService } from './streak-reminder.service.js';

/**
 * Selects the push transport: FCM (firebase-admin) when
 * FIREBASE_SERVICE_ACCOUNT_JSON is set, the capturing DevPushProvider
 * otherwise. Production without FCM credentials fails at boot.
 */
export function createPushProvider(config: AppConfigService): PushProvider {
  const sa = config.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (sa) return FcmPushProvider.fromServiceAccount(sa);
  if (config.isProduction) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is required in production (FCM push delivery).',
    );
  }
  new Logger('NotificationsModule').log(
    'FIREBASE_SERVICE_ACCOUNT_JSON unset — using DevPushProvider',
  );
  return new DevPushProvider();
}

/**
 * Notifications: device-token registry, push delivery (`PushService` —
 * the API other modules use), streak reminders + their hourly cron.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    DevicesService,
    PushService,
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
