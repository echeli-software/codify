import { Global, Module } from '@nestjs/common';
import { LeagueAccumulatorService } from './league-accumulator.service.js';
import { LeaguesService } from './leagues.service.js';
import { FriendsService } from './friends.service.js';
import { ProfileService } from './profile.service.js';
import {
  FriendsController,
  LeaguesController,
  ProfileController,
} from './leagues.controller.js';
import { ReferralsModule } from '../referrals/referrals.module.js';

/**
 * Global so GamificationService can inject LeagueAccumulatorService to
 * accumulate weekly XP on the reward hot path without a circular module ref.
 * LeaguesService (rollover) depends on GamificationService (also global) for
 * granting promotion rewards — a one-way dependency. Friend invite links
 * reuse referral codes (ReferralsModule).
 */
@Global()
@Module({
  imports: [ReferralsModule],
  controllers: [LeaguesController, FriendsController, ProfileController],
  providers: [
    LeagueAccumulatorService,
    LeaguesService,
    FriendsService,
    ProfileService,
  ],
  exports: [LeagueAccumulatorService, LeaguesService],
})
export class LeaguesModule {}
