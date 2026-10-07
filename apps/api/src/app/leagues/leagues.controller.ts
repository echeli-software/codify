import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsISO8601, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import {
  LeaguesService,
  type CurrentLeagueView,
  type LastWeekResultView,
  type RolloverSummary,
} from './leagues.service.js';
import {
  FriendsService,
  type AcceptInviteResult,
  type FriendInviteView,
  type FriendRequestView,
  type FriendView,
} from './friends.service.js';
import { ProfileService, type PublicProfile } from './profile.service.js';

class SendFriendRequestDto {
  @IsEmail()
  email!: string;
}
class RespondDto {
  @IsBoolean()
  accept!: boolean;
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
  @Get('current')
  current(@CurrentUser() actor: ApiUser): Promise<CurrentLeagueView> {
    return this.leagues.getCurrent(actor.userId);
  }

  /** My result for last week's cohort (404 until the rollover has run). */
  @Roles('STUDENT')
  @Get('last-week')
  lastWeek(@CurrentUser() actor: ApiUser): Promise<LastWeekResultView> {
    return this.leagues.getLastWeek(actor.userId);
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
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Roles('STUDENT')
  @Get()
  list(@CurrentUser() actor: ApiUser): Promise<FriendView[]> {
    return this.friends.list(actor.userId);
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

  @Roles('STUDENT')
  @Post(':id/nudge')
  nudge(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.friends.nudge(actor.userId, id);
  }
}

/** Public profiles. */
@Controller('users')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get(':id/profile')
  get(@Param('id') id: string): Promise<PublicProfile> {
    return this.profile.get(id);
  }
}
