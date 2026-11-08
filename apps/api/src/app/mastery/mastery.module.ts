import { Controller, Get, Module } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { MasteryService, type MasteryView } from './mastery.service.js';

/** Skill tree / per-topic mastery (docs/10 §7). */
@Controller('me')
export class MasteryController {
  constructor(private readonly mastery: MasteryService) {}

  @Roles('STUDENT')
  @Get('mastery')
  get(@CurrentUser() actor: ApiUser): Promise<MasteryView> {
    return this.mastery.forUser(actor.userId);
  }
}

@Module({
  controllers: [MasteryController],
  providers: [MasteryService],
})
export class MasteryModule {}
