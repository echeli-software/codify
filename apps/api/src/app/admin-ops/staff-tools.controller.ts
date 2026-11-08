import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { pickLocale } from './admin-ops.util.js';
import {
  ExerciseHealthService,
  type ExerciseHealthRow,
  type RetestJobView,
} from './exercise-health.service.js';
import {
  StaffGrantsService,
  type GrantResult,
} from './staff-grants.service.js';
import {
  ExerciseHealthQueryDto,
  RetestDto,
  StaffGrantDto,
  TermsUpdateDto,
} from './staff-tools.dto.js';
import {
  SystemNoticesService,
  type TermsAnnouncementView,
} from './system-notices.service.js';

function requestMeta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Staff tools (docs/04 Users, docs/10 §3, docs/12 §11): manual coin / XP
 * grants, SYSTEM announcements (terms update), and the exercise dashboard
 * with bulk reference re-tests. Every mutation is audited.
 */
@Controller('admin')
export class StaffToolsController {
  constructor(
    private readonly grants: StaffGrantsService,
    private readonly notices: SystemNoticesService,
    private readonly exerciseHealth: ExerciseHealthService,
    private readonly audit: AuditService,
  ) {}

  // ─── Grants ──────────────────────────────────────────────────────────

  /** Coins (SUPPORT ≤ 1,000 per grant) and/or XP (ADMIN only); daily limits per actor. */
  @Roles('ADMIN', 'SUPPORT')
  @Post('users/:id/grants')
  @HttpCode(201)
  grant(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: StaffGrantDto,
    @Req() req: Request,
  ): Promise<GrantResult> {
    // Audited (`user.coins_granted`) inside the grant transaction.
    return this.grants.grant(actor, id, body, requestMeta(req));
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get('grants/allowance')
  allowance(@CurrentUser() actor: ApiUser) {
    return this.grants.allowance(actor);
  }

  // ─── SYSTEM notices ──────────────────────────────────────────────────

  @Roles('ADMIN')
  @Post('system-notices/terms-update')
  @HttpCode(202)
  async announceTerms(
    @CurrentUser() actor: ApiUser,
    @Body() body: TermsUpdateDto,
    @Req() req: Request,
  ): Promise<TermsAnnouncementView> {
    const view = await this.notices.announceTerms(
      body.version,
      body.effectiveDate ?? null,
    );
    await this.audit.record(actor, {
      action: 'system.terms_update_announced',
      entity: 'SystemNotice',
      entityId: body.version,
      diff: {
        version: body.version,
        effectiveDate: body.effectiveDate ?? null,
        audience: view.audience,
        alreadyNotified: view.notified,
      },
      ...requestMeta(req),
    });
    return view;
  }

  @Roles('ADMIN')
  @Get('system-notices/terms-update/:version')
  termsStatus(
    @Param('version') version: string,
  ): Promise<TermsAnnouncementView> {
    return this.notices.status(version);
  }

  // ─── Exercise dashboard ──────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('exercise-health')
  exerciseDashboard(
    @Query() q: ExerciseHealthQueryDto,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<{ items: ExerciseHealthRow[]; languages: string[] }> {
    return this.exerciseHealth.dashboard(pickLocale(acceptLanguage), {
      language: q.language,
    });
  }

  @Roles('ADMIN')
  @Get('exercise-health/retests')
  retests(): Promise<{ items: RetestJobView[] }> {
    return this.exerciseHealth.listRetests();
  }

  /** Queue a re-run of every reference solution in `language` (202). */
  @Roles('ADMIN')
  @Post('exercise-health/retest')
  @HttpCode(202)
  async retest(
    @CurrentUser() actor: ApiUser,
    @Body() body: RetestDto,
    @Req() req: Request,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<RetestJobView> {
    const job = await this.exerciseHealth.enqueueRetest(
      actor,
      body.language,
      pickLocale(acceptLanguage),
    );
    await this.audit.record(actor, {
      action: 'exercise.bulk_retest_queued',
      entity: 'Exercise',
      entityId: null,
      diff: { jobId: job.jobId, language: job.language, total: job.total },
      ...requestMeta(req),
    });
    return job;
  }
}
