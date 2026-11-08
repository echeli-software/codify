import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { RewardThrottle } from '../common/throttling/throttle.decorators.js';
import { RetryAfterInterceptor } from './rate-limit.js';
import { BrowserResultDto } from './browser-exercise.dto.js';
import { BrowserExerciseService } from './browser-exercise.service.js';
import type { SubmissionView } from './submissions.service.js';

/** Browser-graded HTML/CSS/JS exercises (docs/12 §4). */
@Controller()
export class BrowserExerciseController {
  constructor(private readonly browser: BrowserExerciseService) {}

  @RewardThrottle()
  @Roles('STUDENT')
  @Post('exercises/:id/browser-result')
  @HttpCode(201)
  @UseInterceptors(RetryAfterInterceptor)
  record(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: BrowserResultDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SubmissionView> {
    return this.browser.record(actor.userId, id, body, idempotencyKey);
  }
}
