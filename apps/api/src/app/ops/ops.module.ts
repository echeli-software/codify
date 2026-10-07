import { Module } from '@nestjs/common';
import { LedgerDriftService } from './ledger-drift.service.js';
import { OpsController } from './ops.controller.js';

/** Ops jobs + admin endpoints (ledger drift check). */
@Module({
  controllers: [OpsController],
  providers: [LedgerDriftService],
  exports: [LedgerDriftService],
})
export class OpsModule {}
