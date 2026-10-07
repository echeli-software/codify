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
import type { ScenarioGraph } from '@codify/domain';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ScenariosService,
  type CompleteResult,
  type StudentScenarioView,
} from './scenarios.service.js';
import { CompleteScenarioDto, ScenarioGraphDto } from './scenarios.dto.js';
import { RetryAfterInterceptor } from '../exercises/rate-limit.js';
import { RewardThrottle } from '../common/throttling/throttle.decorators.js';

@Controller()
export class ScenariosController {
  constructor(
    private readonly scenarios: ScenariosService,
    private readonly audit: AuditService,
  ) {}

  // ─── Admin ──────────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER')
  @Post('lessons/:lessonId/scenario')
  async create(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
    @Body() body: ScenarioGraphDto,
    @Req() req: Request,
  ) {
    const created = await this.scenarios.createForLesson(
      actor,
      lessonId,
      body.graph as unknown as ScenarioGraph,
    );
    void this.audit.record(actor, {
      action: 'scenario.create',
      entity: 'Scenario',
      entityId: created.id,
      ip: req.ip ?? null,
    });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('scenarios/:id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: ScenarioGraphDto,
    @Req() req: Request,
  ) {
    const updated = await this.scenarios.update(
      actor,
      id,
      body.graph as unknown as ScenarioGraph,
    );
    void this.audit.record(actor, {
      action: 'scenario.update',
      entity: 'Scenario',
      entityId: id,
      ip: req.ip ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('scenarios/:id')
  getAdmin(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.scenarios.getAdmin(actor, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/scenario/admin')
  getAdminByLesson(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
  ) {
    return this.scenarios.getAdminByLesson(actor, lessonId);
  }

  // ─── Student ────────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @Get('lessons/:lessonId/scenario')
  forStudent(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
  ): Promise<StudentScenarioView> {
    return this.scenarios.getForStudent(actor.userId, lessonId);
  }

  @RewardThrottle()
  @Roles('STUDENT')
  @Post('scenarios/:id/complete')
  @UseInterceptors(RetryAfterInterceptor)
  async complete(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: CompleteScenarioDto,
    @Req() req: Request,
  ): Promise<CompleteResult> {
    const res = await this.scenarios.complete(actor.userId, id, body.path);
    void this.audit.record(actor, {
      action: 'scenario.complete',
      entity: 'Scenario',
      entityId: id,
      diff: {
        completed: res.completed,
        depth: res.depth,
        outcome: res.outcome,
        firstReward: !!res.reward,
      },
      ip: req.ip ?? null,
    });
    return res;
  }
}
