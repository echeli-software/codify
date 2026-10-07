import { Global, Module } from '@nestjs/common';
import { ProgressController } from './progress.controller.js';
import { ProgressService } from './progress.service.js';

/**
 * Global so every completion flow (quiz, exercise, AI prompt, scenario,
 * capstone) can inject ProgressService.recordCompletion without import
 * cycles between feature modules.
 */
@Global()
@Module({
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
