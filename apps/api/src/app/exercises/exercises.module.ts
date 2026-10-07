import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProgressModule } from '../progress/progress.module.js';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesService } from './exercises.service.js';
import {
  CODE_EXECUTOR,
  createCodeExecutor,
} from './code-execution.provider.js';
import {
  SubmissionsService,
  SUBMISSION_TIMINGS,
  submissionTimingsFromEnv,
} from './submissions.service.js';
import { SubmissionProcessor } from './submission.processor.js';
import {
  bullRootOptions,
  SUBMISSION_ENQUEUER,
  SUBMISSION_QUEUE,
} from './submission-queue.js';
import { BullSubmissionEnqueuer } from './bull-submission-enqueuer.js';
import { SubmissionSweeper } from './submission-sweeper.js';

/**
 * Exercises module (docs/12). CODE_EXECUTOR selects Judge0 when JUDGE0_URL
 * is set (required in production) and the child-process dev executor
 * otherwise. Submissions run through a BullMQ queue on REDIS_URL (required
 * in production; dev falls back to inline execution when Redis is down).
 */
@Module({
  imports: [
    BullModule.forRootAsync({ useFactory: () => bullRootOptions(process.env) }),
    BullModule.registerQueue({ name: SUBMISSION_QUEUE }),
    ProgressModule,
  ],
  controllers: [ExercisesController],
  providers: [
    ExercisesService,
    SubmissionsService,
    SubmissionProcessor,
    SubmissionSweeper,
    {
      provide: CODE_EXECUTOR,
      useFactory: () => createCodeExecutor(process.env),
    },
    { provide: SUBMISSION_ENQUEUER, useClass: BullSubmissionEnqueuer },
    {
      provide: SUBMISSION_TIMINGS,
      useFactory: () => submissionTimingsFromEnv(process.env),
    },
  ],
  exports: [ExercisesService, SubmissionsService],
})
export class ExercisesModule {}
