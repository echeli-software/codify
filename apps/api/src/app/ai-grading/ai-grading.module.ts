import { Logger, Module } from '@nestjs/common';
import { AiGradingController } from './ai-grading.controller.js';
import { AiGradingService } from './ai-grading.service.js';
import { AI_GRADER, DevHeuristicGrader, type AiGrader } from './ai-grading.provider.js';

/**
 * AI-prompt grading module. The AI_GRADER seam selects a real LLM judge in
 * production (once ANTHROPIC_API_KEY is wired) and the deterministic
 * DevHeuristicGrader locally.
 */
@Module({
  controllers: [AiGradingController],
  providers: [
    AiGradingService,
    {
      provide: AI_GRADER,
      useFactory: (): AiGrader => {
        if (process.env['ANTHROPIC_API_KEY']) {
          new Logger('AiGradingModule').warn(
            'ANTHROPIC_API_KEY is set but the LLM grader is not implemented yet — using DevHeuristicGrader.',
          );
        }
        return new DevHeuristicGrader();
      },
    },
  ],
  exports: [AiGradingService],
})
export class AiGradingModule {}
