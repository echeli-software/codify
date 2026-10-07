import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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
  ): Promise<QuizAttemptResponse> {
    return this.quizzes.submit(actor, lessonId, body);
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
