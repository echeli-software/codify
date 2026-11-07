import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ReferralsService,
  type ClaimReferralResult,
  type ReferralRewardRun,
  type ReferralView,
} from './referrals.service.js';

export class ClaimReferralDto {
  @IsString()
  @Length(4, 16)
  @Matches(/^[0-9A-Za-z]+$/)
  code!: string;
}

/**
 * Referrals (docs/18-growth.md).
 *   GET  /api/me/referral        — code, share URL, invited/converted/rewards
 *   POST /api/me/referral/claim  — { code } attribute my signup (once, ≤14d)
 *   POST /api/admin/referrals/rewards/run — ADMIN: pay pending rewards now
 */
@Controller()
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Roles('STUDENT')
  @Get('me/referral')
  summary(@CurrentUser() actor: ApiUser): Promise<ReferralView> {
    return this.referrals.getSummary(actor.userId);
  }

  @Roles('STUDENT')
  @Post('me/referral/claim')
  claim(
    @CurrentUser() actor: ApiUser,
    @Body() body: ClaimReferralDto,
  ): Promise<ClaimReferralResult> {
    return this.referrals.claim(actor.userId, body.code);
  }

  @Roles('ADMIN')
  @Post('admin/referrals/rewards/run')
  run(): Promise<ReferralRewardRun> {
    return this.referrals.grantPendingRewards();
  }
}
