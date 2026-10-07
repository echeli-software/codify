import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RubricCriterion } from '@codify/domain';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { AiThrottle } from '../common/throttling/throttle.decorators.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  AiGradingService,
  type GradeResult,
  type StudentAiPromptView,
} from './ai-grading.service.js';
import {
  CreateAiPromptDto,
  ResponseDto,
  UpdateAiPromptDto,
} from './ai-grading.dto.js';

function toInput(dto: CreateAiPromptDto | UpdateAiPromptDto) {
  return {
    ...dto,
    rubric: dto.rubric as unknown as RubricCriterion[] | undefined,
  };
}

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
      lessonId,
      toInput(body) as Parameters<AiGradingService['createForLesson']>[1],
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
  update(@Param('id') id: string, @Body() body: UpdateAiPromptDto) {
    return this.ai.update(id, toInput(body));
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('ai-prompts/:id')
  getAdmin(@Param('id') id: string) {
    return this.ai.getAdmin(id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/ai-prompt/admin')
  getAdminByLesson(@Param('lessonId') lessonId: string) {
    return this.ai.getAdminByLesson(lessonId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('ai-prompts/:id/preview')
  preview(@Param('id') id: string, @Body() body: ResponseDto) {
    return this.ai.preview(id, body.response);
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
  @AiThrottle()
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
        firstReward: !!res.reward,
      },
      ip: req.ip ?? null,
    });
    return res;
  }
}
