import { Controller, Get, Module } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { MasteryService, type MasteryView } from './mastery.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/** Skill tree / per-topic mastery (docs/10 §7); reviews: reviews.controller. */
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
  controllers: [MasteryController, ReviewsController],
  providers: [MasteryService, ReviewsService],
})
export class MasteryModule {}
