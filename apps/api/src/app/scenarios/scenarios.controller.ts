import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ScenarioGraph } from '@codify/domain';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { ScenariosService, type CompleteResult, type StudentScenarioView } from './scenarios.service.js';
import { CompleteScenarioDto, ScenarioGraphDto } from './scenarios.dto.js';

@Controller()
export class ScenariosController {
  constructor(
    private readonly scenarios: ScenariosService,
    private readonly audit: AuditService,
  ) {}

  // ─── Admin ──────────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER')
  @Post('lessons/:lessonId/scenario')
  async create(@CurrentUser() actor: ApiUser, @Param('lessonId') lessonId: string, @Body() body: ScenarioGraphDto, @Req() req: Request) {
    const created = await this.scenarios.createForLesson(lessonId, body.graph as unknown as ScenarioGraph);
    void this.audit.record(actor, { action: 'scenario.create', entity: 'Scenario', entityId: created.id, ip: req.ip ?? null });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('scenarios/:id')
  update(@Param('id') id: string, @Body() body: ScenarioGraphDto) {
    return this.scenarios.update(id, body.graph as unknown as ScenarioGraph);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('scenarios/:id')
  getAdmin(@Param('id') id: string) {
    return this.scenarios.getAdmin(id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/scenario/admin')
  getAdminByLesson(@Param('lessonId') lessonId: string) {
    return this.scenarios.getAdminByLesson(lessonId);
  }

  // ─── Student ────────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @Get('lessons/:lessonId/scenario')
  forStudent(@CurrentUser() actor: ApiUser, @Param('lessonId') lessonId: string): Promise<StudentScenarioView> {
    return this.scenarios.getForStudent(actor.userId, lessonId);
  }

  @Roles('STUDENT')
  @Post('scenarios/:id/complete')
  async complete(@CurrentUser() actor: ApiUser, @Param('id') id: string, @Body() body: CompleteScenarioDto, @Req() req: Request): Promise<CompleteResult> {
    const res = await this.scenarios.complete(actor.userId, id, body.path);
    void this.audit.record(actor, {
      action: 'scenario.complete',
      entity: 'Scenario',
      entityId: id,
      diff: { completed: res.completed, depth: res.depth, outcome: res.outcome, firstReward: !!res.reward },
      ip: req.ip ?? null,
    });
    return res;
  }
}
