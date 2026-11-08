import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ReviewQueueQueryDto,
  SubmitReviewDto,
  type ReviewQueue,
  type ReviewResult,
} from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

/** Spaced-repetition mastery checks (docs/10 §7). */
@Controller('me/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Due review cards (oldest first) with their quiz questions, keys stripped. */
  @Roles('STUDENT')
  @Get()
  queue(
    @CurrentUser() actor: ApiUser,
    @Query() query: ReviewQueueQueryDto,
  ): Promise<ReviewQueue> {
    return this.reviews.queue(actor.userId, query.limit);
  }

  /** Grade a due review; moves the card between Leitner boxes. */
  @Roles('STUDENT')
  @Post(':lessonId')
  @HttpCode(200)
  submit(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
    @Body() body: SubmitReviewDto,
  ): Promise<ReviewResult> {
    return this.reviews.submit(actor.userId, lessonId, body.answers);
  }
}
