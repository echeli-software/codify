import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import {
  LeaguesService,
  type CurrentLeagueView,
  type LastWeekResultView,
  type LeagueHistoryEntry,
  type RolloverSummary,
} from './leagues.service.js';
import {
  FriendsService,
  type AcceptInviteResult,
  type ActivityFeedEntry,
  type FriendCompareView,
  type FriendInviteView,
  type FriendRequestView,
  type FriendView,
} from './friends.service.js';
import { ProfileService, type PublicProfile } from './profile.service.js';
import { RequireFeature } from '../flags/feature.guard.js';

class SendFriendRequestDto {
  @IsEmail()
  email!: string;
}
class RespondDto {
  @IsBoolean()
  accept!: boolean;
}
class LimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  limit?: number;
}
class RolloverDto {
  @IsOptional()
  @IsISO8601()
  weekStart?: string;
}

/** Leagues (student) + rollover (admin). */
@Controller('league')
export class LeaguesController {
  constructor(
    private readonly leagues: LeaguesService,
    private readonly audit: AuditService,
  ) {}

  @Roles('STUDENT')
  @RequireFeature('leagues.enabled')
  @Get('current')
  current(@CurrentUser() actor: ApiUser): Promise<CurrentLeagueView> {
    return this.leagues.getCurrent(actor.userId);
  }

  /** My result for last week's cohort (404 until the rollover has run). */
  @Roles('STUDENT')
  @RequireFeature('leagues.enabled')
  @Get('last-week')
  lastWeek(@CurrentUser() actor: ApiUser): Promise<LastWeekResultView> {
    return this.leagues.getLastWeek(actor.userId);
  }

  /** My finished league weeks, newest first (docs/05 League "Past weeks"). */
  @Roles('STUDENT')
  @RequireFeature('leagues.enabled')
  @Get('history')
  history(
    @CurrentUser() actor: ApiUser,
    @Query() query: LimitQueryDto,
  ): Promise<LeagueHistoryEntry[]> {
    return this.leagues.getHistory(actor.userId, query.limit ?? 12);
  }

  @Roles('ADMIN')
  @Post('rollover')
  async rollover(
    @CurrentUser() actor: ApiUser,
    @Body() body: RolloverDto,
  ): Promise<RolloverSummary> {
    const res = await this.leagues.runRollover(body.weekStart);
    void this.audit.record(actor, {
      action: 'league.rollover',
      entity: 'League',
      diff: { ...res },
    });
    return res;
  }
}

/** Friends + invite links. */
@RequireFeature('friends.enabled')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Roles('STUDENT')
  @Get()
  list(@CurrentUser() actor: ApiUser): Promise<FriendView[]> {
    return this.friends.list(actor.userId);
  }

  /** Opted-in friends' recent completions + badges (docs/10 §5). */
  @Roles('STUDENT')
  @Get('activity')
  activity(
    @CurrentUser() actor: ApiUser,
    @Query() query: LimitQueryDto,
  ): Promise<ActivityFeedEntry[]> {
    return this.friends.activity(actor.userId, query.limit ?? 20);
  }

  @Roles('STUDENT')
  @Get('requests')
  requests(@CurrentUser() actor: ApiUser): Promise<FriendRequestView[]> {
    return this.friends.incomingRequests(actor.userId);
  }

  /** Same response whether or not the email has an account (no enumeration). */
  @Roles('STUDENT')
  @Post('requests')
  send(
    @CurrentUser() actor: ApiUser,
    @Body() body: SendFriendRequestDto,
  ): Promise<{ status: 'sent' }> {
    return this.friends.sendRequest(actor.userId, body.email);
  }

  @Roles('STUDENT')
  @Post('requests/:id/respond')
  respond(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: RespondDto,
  ) {
    return this.friends.respond(actor.userId, id, body.accept);
  }

  @Roles('STUDENT')
  @Get('invite')
  invite(@CurrentUser() actor: ApiUser): Promise<FriendInviteView> {
    return this.friends.invite(actor.userId);
  }

  @Roles('STUDENT')
  @Post('invite/:code/accept')
  acceptInvite(
    @CurrentUser() actor: ApiUser,
    @Param('code') code: string,
  ): Promise<AcceptInviteResult> {
    return this.friends.acceptInvite(actor.userId, code);
  }

  /** Side-by-side stats with a friend; 403 FRIEND_REQUIRED otherwise. */
  @Roles('STUDENT')
  @Get(':id/compare')
  compare(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<FriendCompareView> {
    return this.friends.compare(actor.userId, id);
  }

  @Roles('STUDENT')
  @Post(':id/nudge')
  nudge(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.friends.nudge(actor.userId, id);
  }
}

/**
 * Public profiles. A minor's profile is visible to the user and their
 * friends only; others get 404 like an unknown user (docs/14 "Minors").
 */
@Controller('users')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get(':id/profile')
  get(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<PublicProfile> {
    return this.profile.get(id, actor.userId);
  }
}
