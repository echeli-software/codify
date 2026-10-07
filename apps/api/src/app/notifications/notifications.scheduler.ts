import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { reportException } from '../common/sentry.js';
import { AppConfigService } from '../config/app-config.service.js';
import { jobsEnabled } from '../config/env.js';
import { StreakReminderService } from './streak-reminder.service.js';

/**
 * Hourly streak-reminder sweep. Each run only reaches users whose local
 * time is in the evening slot (see StreakReminderService.EVENING_SLOT), so
 * an hourly UTC cron covers every timezone. Idempotent per user per local
 * day. Disabled with JOBS_ENABLED=false and never scheduled under jest.
 */
@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly reminders: StreakReminderService,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'streak-reminders',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  async streakReminders(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    try {
      await this.reminders.run({ mode: 'scheduled' });
    } catch (err) {
      this.logger.error(
        `streak reminder job failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      reportException(err, { tags: { job: 'streak-reminders' } });
    }
  }
}
