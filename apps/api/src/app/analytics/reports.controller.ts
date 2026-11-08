import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { pickLocale } from '../admin-ops/admin-ops.util.js';
import {
  ReportsService,
  type CourseFunnelRow,
  type LessonFunnelRow,
  type OverviewReport,
} from './reports.service.js';

/**
 * Admin analytics reports (docs/04 "Analytics", docs/09 §13): retention by
 * signup cohort, league participation, shop revenue in coins, MRR per plan,
 * churn / net new, trial → paid, ARPPU and refund rate (ADMIN); per-course
 * funnels and lesson drop-off (ADMIN every course, TEACHER own courses).
 */
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** `?fresh=1` bypasses the 10-minute cache. */
  @Roles('ADMIN')
  @Get('overview')
  overview(@Query('fresh') fresh?: string): Promise<OverviewReport> {
    return this.reports.overview(new Date(), fresh === '1' || fresh === 'true');
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('courses')
  courses(
    @CurrentUser() actor: ApiUser,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<{ items: CourseFunnelRow[] }> {
    return this.reports.courseFunnels(actor, pickLocale(acceptLanguage));
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('courses/:id')
  course(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<{ course: CourseFunnelRow; lessons: LessonFunnelRow[] }> {
    return this.reports.courseFunnel(actor, id, pickLocale(acceptLanguage));
  }
}
