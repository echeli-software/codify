import { Controller, HttpCode, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { DailyQuestReminderService } from './daily-quest-reminder.service.js';
import { ReactivationService } from './reactivation.service.js';
import { WeeklyRecapService } from './weekly-recap.service.js';

/**
 * ADMIN triggers for the engagement notification jobs (they also run on
 * their crons). Manual runs ignore the time-of-day windows but keep every
 * idempotency claim, so they never double-send.
 */
@Controller('admin/engagement')
@Roles('ADMIN')
export class EngagementController {
  constructor(
    private readonly reminders: DailyQuestReminderService,
    private readonly recap: WeeklyRecapService,
    private readonly reactivation: ReactivationService,
  ) {}

  @Post('daily-quest-reminders/run')
  @HttpCode(200)
  runReminders() {
    return this.reminders.run({ mode: 'manual' });
  }

  @Post('weekly-recap/run')
  @HttpCode(200)
  runRecap(@Query('userId') userId?: string) {
    return this.recap.run({ mode: 'manual', ...(userId ? { userId } : {}) });
  }

  @Post('reactivation/run')
  @HttpCode(200)
  runReactivation() {
    return this.reactivation.run();
  }
}
