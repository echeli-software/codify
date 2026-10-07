import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { reportException } from '../common/sentry.js';
import { AppConfigService } from '../config/app-config.service.js';
import { jobsEnabled } from '../config/env.js';
import { BillingJobsService } from './billing-jobs.service.js';

/**
 * Daily billing jobs (UTC). Disabled with JOBS_ENABLED=false and never
 * scheduled under jest. Both are idempotent, so a missed or doubled run is
 * harmless.
 */
@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    private readonly jobs: BillingJobsService,
    private readonly config: AppConfigService,
  ) {}

  @Cron('17 3 * * *', {
    name: 'billing-subscription-sweeper',
    timeZone: 'UTC',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  async sweepSubscriptions(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    try {
      await this.jobs.sweepSubscriptions();
    } catch (err) {
      this.fail('billing-subscription-sweeper', err);
    }
  }

  /** 12:43 UTC ≈ mid-morning in Brazil, outside default quiet hours. */
  @Cron('43 12 * * *', {
    name: 'billing-pix-renewal-reminders',
    timeZone: 'UTC',
    disabled: !jobsEnabled(),
    waitForCompletion: true,
  })
  async renewalReminders(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    try {
      await this.jobs.sendRenewalReminders();
    } catch (err) {
      this.fail('billing-pix-renewal-reminders', err);
    }
  }

  private fail(job: string, err: unknown): void {
    this.logger.error(
      `${job} failed: ${(err as Error).message}`,
      (err as Error).stack,
    );
    reportException(err, { tags: { job } });
  }
}
