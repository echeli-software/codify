import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { GamificationService } from './gamification.service.js';

/**
 * Read-only gamification snapshot for the student app header + boot
 * reconcile (XP/level/coins/streak). All earning happens server-side via
 * the reward pipeline; this is display state only.
 */
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Roles('STUDENT')
  @Get('summary')
  summary(@CurrentUser() actor: ApiUser) {
    return this.gamification.getSummary(actor.userId);
  }
}
