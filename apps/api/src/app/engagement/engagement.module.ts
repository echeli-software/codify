import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DailyQuestReminderService } from './daily-quest-reminder.service.js';
import { EngagementController } from './engagement.controller.js';
import { EngagementScheduler } from './engagement.scheduler.js';
import { ReactivationService } from './reactivation.service.js';
import { UserLifecycleService } from './user-lifecycle.service.js';
import { WeeklyRecapService } from './weekly-recap.service.js';
import { WelcomeBackQuest } from './welcome-back-quest.js';

/**
 * Engagement notification jobs (docs/10 §3 daily-quest reminder + weekly
 * recap, §13 reactivation) and the user-lifecycle hooks the auth
 * middleware calls (welcome, return-from-lapse). Global so AuthMiddleware
 * can inject UserLifecycleService without AuthModule importing it.
 * QuestsService comes from the global GamificationModule.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [EngagementController],
  providers: [
    DailyQuestReminderService,
    WeeklyRecapService,
    ReactivationService,
    WelcomeBackQuest,
    UserLifecycleService,
    EngagementScheduler,
  ],
  exports: [UserLifecycleService],
})
export class EngagementModule {}
