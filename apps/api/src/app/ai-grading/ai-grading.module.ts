import { Module } from '@nestjs/common';
import { ProgressModule } from '../progress/progress.module.js';
import { AiGradingController } from './ai-grading.controller.js';
import { AiGradingService } from './ai-grading.service.js';
import { AI_GRADER, createAiGrader } from './ai-grading.provider.js';

/**
 * AI-prompt grading module (docs/17). AI_GRADER selects the Anthropic judge
 * when ANTHROPIC_API_KEY is set (required in production) and the
 * deterministic DevHeuristicGrader otherwise.
 */
@Module({
  imports: [ProgressModule],
  controllers: [AiGradingController],
  providers: [
    AiGradingService,
    { provide: AI_GRADER, useFactory: () => createAiGrader(process.env) },
  ],
  exports: [AiGradingService],
})
export class AiGradingModule {}
