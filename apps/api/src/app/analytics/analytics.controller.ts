import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { AnalyticsService } from './analytics.service.js';
import {
  AnalyticsBatchDto,
  type AnalyticsSummaryRow,
} from './analytics.dto.js';

@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Batched event ingest. Public so pre-login events (onboarding, marketing
   * page) are captured; the auth middleware still attributes signed-in
   * callers. Covered by the default per-user/IP throttle.
   */
  @Public()
  @Post('analytics/events')
  @HttpCode(202)
  ingest(
    @Body() body: AnalyticsBatchDto,
    @Req() req: Request,
  ): Promise<{ accepted: number }> {
    return this.analytics.ingest(req.user?.userId ?? null, body);
  }

  /** Event counts per name per UTC day (default: last 30 days, max 92). */
  @Roles('ADMIN')
  @Get('admin/analytics/summary')
  summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AnalyticsSummaryRow[]> {
    return this.analytics.summary(from, to);
  }
}
