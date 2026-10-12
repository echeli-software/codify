import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { RewardThrottle } from '../common/throttling/throttle.decorators.js';
import { QuizzesService } from './quizzes.service.js';
import {
  SubmitQuizAttemptDto,
  type QuizAttemptResponse,
  type QuizAttemptSummary,
} from './quizzes.dto.js';

/** Same shape the exercises submit endpoint accepts. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

@Controller('lessons/:id/quiz/attempts')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  /** Grade an attempt server-side; a pass completes the lesson (reward once). */
  @Roles('STUDENT')
  @RewardThrottle()
  @Post()
  @HttpCode(201)
  submit(
    @CurrentUser() actor: ApiUser,
    @Param('id') lessonId: string,
    @Body() body: SubmitQuizAttemptDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<QuizAttemptResponse> {
    if (
      idempotencyKey !== undefined &&
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be 8–128 characters of [A-Za-z0-9_.:-]',
      });
    }
    return this.quizzes.submit(actor, lessonId, body, idempotencyKey);
  }

  /** The caller's recent attempts on this lesson (newest first, max 20). */
  @Roles('STUDENT')
  @Get()
  mine(
    @CurrentUser() actor: ApiUser,
    @Param('id') lessonId: string,
  ): Promise<QuizAttemptSummary[]> {
    return this.quizzes.listMine(actor, lessonId);
  }
}
