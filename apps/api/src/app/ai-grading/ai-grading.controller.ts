import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RubricCriterion } from '@codify/domain';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { RetryAfterInterceptor } from '../exercises/rate-limit.js';
import {
  AiGradingService,
  type AiPromptInput,
  type GradeResult,
  type StudentAiPromptView,
} from './ai-grading.service.js';
import {
  CreateAiPromptDto,
  ResponseDto,
  UpdateAiPromptDto,
} from './ai-grading.dto.js';

function toInput(
  dto: CreateAiPromptDto | UpdateAiPromptDto,
): Partial<AiPromptInput> {
  return {
    ...dto,
    rubric: dto.rubric as unknown as RubricCriterion[] | undefined,
  };
}

/**
 * AI-prompt (and CAPSTONE) lessons — docs/17.
 *
 * Admin (ADMIN, or a TEACHER on their own course): create/update/read a
 * prompt + rubric, preview a sample answer. Student: read the prompt
 * (rubric labels only) and submit; 429 + Retry-After past 1 / 3 s per
 * prompt, 5 / min or 60 / day per user.
 */
@Controller()
export class AiGradingController {
  constructor(
    private readonly ai: AiGradingService,
    private readonly audit: AuditService,
  ) {}

  // ─── Admin ──────────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER')
  @Post('lessons/:lessonId/ai-prompt')
  async create(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
    @Body() body: CreateAiPromptDto,
    @Req() req: Request,
  ) {
    const created = await this.ai.createForLesson(
      actor,
      lessonId,
      toInput(body) as AiPromptInput,
    );
    void this.audit.record(actor, {
      action: 'ai_prompt.create',
      entity: 'AiPrompt',
      entityId: created.id,
      ip: req.ip ?? null,
    });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('ai-prompts/:id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateAiPromptDto,
    @Req() req: Request,
  ) {
    const updated = await this.ai.update(actor, id, toInput(body));
    void this.audit.record(actor, {
      action: 'ai_prompt.update',
      entity: 'AiPrompt',
      entityId: id,
      diff: { fields: Object.keys(body) },
      ip: req.ip ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('ai-prompts/:id')
  getAdmin(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.ai.getAdmin(actor, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/ai-prompt/admin')
  getAdminByLesson(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
  ) {
    return this.ai.getAdminByLesson(actor, lessonId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('ai-prompts/:id/preview')
  preview(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: ResponseDto,
  ) {
    return this.ai.preview(actor, id, body.response);
  }

  // ─── Student ────────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @Get('lessons/:lessonId/ai-prompt')
  forStudent(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
  ): Promise<StudentAiPromptView> {
    return this.ai.getForStudent(actor.userId, lessonId);
  }

  @Roles('STUDENT')
  @Post('ai-prompts/:id/submit')
  @UseInterceptors(RetryAfterInterceptor)
  async submit(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: ResponseDto,
    @Req() req: Request,
  ): Promise<GradeResult> {
    const res = await this.ai.submit(actor.userId, id, body.response);
    void this.audit.record(actor, {
      action: 'ai_prompt.submit',
      entity: 'AiPrompt',
      entityId: id,
      diff: {
        scorePct: res.scorePct,
        passed: res.passed,
        cached: res.cached,
        gradedBy: res.gradedBy,
        firstReward: !!res.reward,
      },
      ip: req.ip ?? null,
    });
    return res;
  }
}
