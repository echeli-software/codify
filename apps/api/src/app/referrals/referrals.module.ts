import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

/** Referral codes, attribution and referrer rewards (docs/18-growth.md). */
@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
