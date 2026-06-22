import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { LeaguesService, type CurrentLeagueView } from './leagues.service.js';
import { FriendsService, type FriendRequestView, type FriendView } from './friends.service.js';
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
  @IsString()
  weekStart?: string;
}

/** Leagues (student) + rollover (admin). */
@Controller('league')
export class LeaguesController {
  constructor(private readonly leagues: LeaguesService) {}

  @Roles('STUDENT')
  @Get('current')
  current(@CurrentUser() actor: ApiUser): Promise<CurrentLeagueView> {
    return this.leagues.getCurrent(actor.userId);
  }

  @Roles('ADMIN')
  @Post('rollover')
  rollover(@Body() body: RolloverDto) {
    return this.leagues.runRollover(body.weekStart);
  }
}

/** Friends MVP. */
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

  @Roles('STUDENT')
  @Post('requests')
  send(@CurrentUser() actor: ApiUser, @Body() body: SendFriendRequestDto) {
    return this.friends.sendRequest(actor.userId, body.email);
  }

  @Roles('STUDENT')
  @Post('requests/:id/respond')
  respond(@CurrentUser() actor: ApiUser, @Param('id') id: string, @Body() body: RespondDto) {
    return this.friends.respond(actor.userId, id, body.accept);
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
