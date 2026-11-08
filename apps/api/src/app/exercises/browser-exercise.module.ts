import { Module } from '@nestjs/common';
import { ProgressModule } from '../progress/progress.module.js';
import { BrowserExerciseController } from './browser-exercise.controller.js';
import { BrowserExerciseService } from './browser-exercise.service.js';

/** Browser-side (iframe-graded) exercises — docs/12 §4. */
@Module({
  imports: [ProgressModule],
  controllers: [BrowserExerciseController],
  providers: [BrowserExerciseService],
})
export class BrowserExerciseModule {}
