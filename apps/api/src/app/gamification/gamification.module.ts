import { Global, Module } from '@nestjs/common';
import { GamificationService } from './gamification.service.js';
import { GamificationConfigService } from './gamification-config.service.js';
import { QuestsService } from './quests.service.js';
import { BadgesService } from './badges.service.js';
import { MultipliersService } from './multipliers.service.js';
import { QuestsController } from './quests.controller.js';
import { BadgesController } from './badges.controller.js';
import { GamificationController } from './gamification.controller.js';
import { GamificationConfigController } from './gamification-config.controller.js';
import { MultipliersController } from './multipliers.controller.js';
import { UserPushService } from './user-push.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * Global gamification module — the server-authoritative reward pipeline
 * (GamificationService) plus daily quests and badges, all of which grant
 * through the same pipeline. Exported so lesson completion can advance
 * quests + evaluate badges inside its transaction. GamificationConfigService
 * is exported so billing/leagues/referrals read the same admin knobs.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [
    QuestsController,
    BadgesController,
    GamificationController,
    GamificationConfigController,
    MultipliersController,
  ],
  providers: [
    GamificationService,
    GamificationConfigService,
    QuestsService,
    BadgesService,
    MultipliersService,
    UserPushService,
  ],
  exports: [
    GamificationService,
    GamificationConfigService,
    QuestsService,
    BadgesService,
    UserPushService,
  ],
})
export class GamificationModule {}
