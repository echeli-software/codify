import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { reportException } from '../common/sentry.js';
import { jobsEnabled } from '../config/env.js';
import { DailyQuestReminderService } from './daily-quest-reminder.service.js';
import { ReactivationService } from './reactivation.service.js';
import { WeeklyRecapService } from './weekly-recap.service.js';

/** Cron expressions (UTC) for the notification jobs (docs/10 §3, §13). */
export const NOTIFICATION_CRONS = {
  /** Every 15 min: daily-quest reminders due in each user's local time. */
  dailyQuestReminders: '*/15 * * * *',
  /** Hourly: weekly recap for zones where it's Monday 09:00–12:00. */
  weeklyRecap: '20 * * * *',
  /** Daily 13:40 UTC (late morning in Brazil): reactivation sweep. */
  reactivation: '40 13 * * *',
} as const;

/**
 * Engagement notification jobs. Disabled with JOBS_ENABLED=false and never
 * scheduled under jest; every job is idempotent (per-day / per-week
 * claims, reactivation stage), so overlapping replicas are safe.
 */
@Injectable()
export class EngagementScheduler {
  private readonly logger = new Logger(EngagementScheduler.name);

  constructor(
    private readonly reminders: DailyQuestReminderService,
    private readonly recap: WeeklyRecapService,
    private readonly reactivation: ReactivationService,
  ) {}

  @Cron(NOTIFICATION_CRONS.dailyQuestReminders, {
    name: 'daily-quest-reminders',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  dailyQuestReminders(): Promise<void> {
    return this.guard('daily-quest-reminders', () =>
      this.reminders.run({ mode: 'scheduled' }),
    );
  }

  @Cron(NOTIFICATION_CRONS.weeklyRecap, {
    name: 'weekly-recap',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  weeklyRecap(): Promise<void> {
    return this.guard('weekly-recap', () =>
      this.recap.run({ mode: 'scheduled' }),
    );
  }

  @Cron(NOTIFICATION_CRONS.reactivation, {
    name: 'reactivation',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  reactivationSweep(): Promise<void> {
    return this.guard('reactivation', () => this.reactivation.run());
  }

  private async guard(job: string, fn: () => Promise<unknown>): Promise<void> {
    if (!jobsEnabled()) return;
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `${job} job failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      reportException(err, { tags: { job } });
    }
  }
}
