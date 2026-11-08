import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { LeaguesService } from '../leagues/leagues.service.js';
import { EconomyJobsService } from './economy-jobs.service.js';

const JOBS = [
  'streak-settle',
  'weekly-bonus',
  'promo-announce',
  'league-results',
] as const;
type EconomyJob = (typeof JOBS)[number];

/**
 * ADMIN triggers for the economy jobs (same code the crons run; all
 * idempotent):
 *   POST /api/admin/gamification/jobs/streak-settle/run   — freezes / lost streaks
 *   POST /api/admin/gamification/jobs/weekly-bonus/run    — pay closed weeks' bonus pools
 *   POST /api/admin/gamification/jobs/promo-announce/run  — PROMO for promos that just started
 *   POST /api/admin/gamification/jobs/league-results/run  — LEAGUE_RESULT for users past Monday 09:00
 */
@Controller('admin/gamification/jobs')
@Roles('ADMIN')
export class EconomyAdminController {
  constructor(
    private readonly jobs: EconomyJobsService,
    private readonly leagues: LeaguesService,
    private readonly audit: AuditService,
  ) {}

  @Post(':job/run')
  async run(
    @CurrentUser() actor: ApiUser,
    @Param('job') job: string,
  ): Promise<object> {
    if (!(JOBS as readonly string[]).includes(job))
      throw new BadRequestException({
        code: 'UNKNOWN_JOB',
        message: `job must be one of ${JOBS.join(', ')}`,
      });
    const res = await this.runJob(job as EconomyJob);
    void this.audit.record(actor, {
      action: 'gamification.job.run',
      entity: 'Job',
      entityId: job,
      diff: { ...res },
    });
    return res;
  }

  private runJob(job: EconomyJob): Promise<object> {
    switch (job) {
      case 'streak-settle':
        return this.jobs.settleStreaks();
      case 'weekly-bonus':
        return this.jobs.payWeeklyBonusPools();
      case 'promo-announce':
        return this.jobs.announcePromotions();
      case 'league-results':
        return this.leagues.sendLeagueResults();
    }
  }
}
