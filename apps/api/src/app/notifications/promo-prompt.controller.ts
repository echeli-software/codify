import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  PromoPromptService,
  type PromoPromptAnswer,
  type PromoPromptState,
} from './promo-prompt.service.js';

export class PromoPromptAnswerDto {
  /** Turn PROMO push on (the main "Yes"). */
  @IsBoolean()
  push!: boolean;

  /** The separate "also by email" tick box (marketing email consent). */
  @IsBoolean()
  email!: boolean;
}

/**
 * The one-time promotional-alerts prompt (docs/10 §3). Any signed-in user,
 * own account only.
 *
 *   GET  /me/promo-prompt   `{ show, promptedAt }` — show is true for an
 *                           adult with ≥ 1 completed lesson not yet asked
 *   POST /me/promo-prompt   `{ push, email }` → `{ promptedAt, push, email }`;
 *                           403 PROMO_PROMPT_NOT_ALLOWED (minor / age not
 *                           given), 409 PROMO_PROMPT_ANSWERED
 */
@Controller('me/promo-prompt')
export class PromoPromptController {
  constructor(private readonly prompts: PromoPromptService) {}

  @Get()
  state(@CurrentUser() actor: ApiUser): Promise<PromoPromptState> {
    return this.prompts.state(actor.userId);
  }

  @Post()
  @HttpCode(200)
  answer(
    @CurrentUser() actor: ApiUser,
    @Body() body: PromoPromptAnswerDto,
  ): Promise<PromoPromptAnswer> {
    return this.prompts.answer(actor, body);
  }
}
