import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import {
  LedgerDriftService,
  type LedgerDriftReport,
} from './ledger-drift.service.js';

/** Operational endpoints for admins (`/api/admin/ops/*`). */
@Controller('admin/ops')
@Roles('ADMIN')
export class OpsController {
  constructor(private readonly drift: LedgerDriftService) {}

  /** Last drift-check result (null until the first run since boot). */
  @Get('drift')
  lastDrift(): { report: LedgerDriftReport | null } {
    return { report: this.drift.lastReport() };
  }

  /** Run the drift check now and return its report. */
  @Post('drift')
  @HttpCode(200)
  async runDrift(): Promise<{ report: LedgerDriftReport }> {
    return { report: await this.drift.run('manual') };
  }
}
