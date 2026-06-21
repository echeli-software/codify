import { Global, Module } from '@nestjs/common';
import { GamificationService } from './gamification.service.js';

/**
 * Global gamification module — exposes the server-authoritative reward
 * pipeline (GamificationService) to any feature that grants rewards
 * (lesson completion, quests, milestones, admin grants).
 */
@Global()
@Module({
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
