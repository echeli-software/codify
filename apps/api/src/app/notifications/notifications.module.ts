import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { DevicesService } from './devices.service.js';
import { StreakReminderService } from './streak-reminder.service.js';
import { PUSH_PROVIDER, DevPushProvider, type PushProvider } from './push.provider.js';

/**
 * Notifications module. The PUSH_PROVIDER seam selects FCM/APNs in production
 * (once FCM_SERVICE_ACCOUNT is wired) and the capturing DevPushProvider
 * locally so the register → trigger → deliver flow is verifiable offline.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    DevicesService,
    StreakReminderService,
    {
      provide: PUSH_PROVIDER,
      useFactory: (): PushProvider => {
        // Real FcmPushProvider lands here once FCM_SERVICE_ACCOUNT is wired;
        // native delivery (signed APNs/FCM + devices) is store-side.
        return new DevPushProvider();
      },
    },
  ],
  exports: [DevicesService, StreakReminderService, PUSH_PROVIDER],
})
export class NotificationsModule {}
