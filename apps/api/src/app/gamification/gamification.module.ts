import { Global, Module } from '@nestjs/common';
import { GamificationService } from './gamification.service.js';
import { QuestsService } from './quests.service.js';
import { BadgesService } from './badges.service.js';
import { MultipliersService } from './multipliers.service.js';
import { QuestsController } from './quests.controller.js';
import { BadgesController } from './badges.controller.js';
import { GamificationController } from './gamification.controller.js';
import { MultipliersController } from './multipliers.controller.js';

/**
 * Global gamification module — the server-authoritative reward pipeline
 * (GamificationService) plus daily quests and badges, all of which grant
 * through the same pipeline. Exported so lesson completion can advance
 * quests + evaluate badges inside its transaction.
 */
@Global()
@Module({
  controllers: [QuestsController, BadgesController, GamificationController, MultipliersController],
  providers: [GamificationService, QuestsService, BadgesService, MultipliersService],
  exports: [GamificationService, QuestsService, BadgesService],
})
export class GamificationModule {}
