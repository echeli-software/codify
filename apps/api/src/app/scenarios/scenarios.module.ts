import { Module } from '@nestjs/common';
import { ProgressModule } from '../progress/progress.module.js';
import { ScenariosController } from './scenarios.controller.js';
import { ScenariosService } from './scenarios.service.js';

/** Branching-dialogue scenario lessons (Phase 12). */
@Module({
  imports: [ProgressModule],
  controllers: [ScenariosController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
