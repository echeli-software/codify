import { Logger, Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesService } from './exercises.service.js';
import { CODE_EXECUTOR, DevJsExecutor, type CodeExecutor } from './code-execution.provider.js';

/**
 * Exercises module. The CODE_EXECUTOR seam selects Judge0 in production
 * (once JUDGE0_URL is wired) and the vm-based DevJsExecutor locally.
 */
@Module({
  controllers: [ExercisesController],
  providers: [
    ExercisesService,
    {
      provide: CODE_EXECUTOR,
      useFactory: (): CodeExecutor => {
        if (process.env['JUDGE0_URL']) {
          new Logger('ExercisesModule').warn(
            'JUDGE0_URL is set but the Judge0 executor is not implemented yet — using DevJsExecutor.',
          );
        }
        return new DevJsExecutor();
      },
    },
  ],
  exports: [ExercisesService],
})
export class ExercisesModule {}
