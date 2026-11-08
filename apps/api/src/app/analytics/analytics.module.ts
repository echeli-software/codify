import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [AnalyticsController, ReportsController],
  providers: [AnalyticsService, ReportsService],
})
export class AnalyticsModule {}
