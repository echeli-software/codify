import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { CodeThrottle } from '../common/throttling/throttle.decorators.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ExercisesService,
  type RunResult,
  type StudentExerciseView,
  type SubmitResult,
} from './exercises.service.js';
import {
  CodeDto,
  CreateExerciseDto,
  UpdateExerciseDto,
} from './exercises.dto.js';
import type { TestCase } from '@codify/domain';

function toInput(dto: CreateExerciseDto | UpdateExerciseDto) {
  return {
    ...dto,
    visibleTests: dto.visibleTests as unknown as TestCase[] | undefined,
    hiddenTests: dto.hiddenTests as unknown as TestCase[] | undefined,
  };
}

@Controller()
export class ExercisesController {
  constructor(
    private readonly exercises: ExercisesService,
    private readonly audit: AuditService,
  ) {}

  // ─── Admin ──────────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER')
  @Post('lessons/:lessonId/exercise')
  async create(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
    @Body() body: CreateExerciseDto,
    @Req() req: Request,
  ) {
    const created = await this.exercises.createForLesson(
      lessonId,
      toInput(body) as Parameters<ExercisesService['createForLesson']>[1],
    );
    void this.audit.record(actor, {
      action: 'exercise.create',
      entity: 'Exercise',
      entityId: created.id,
      ip: req.ip ?? null,
    });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('exercises/:id')
  update(@Param('id') id: string, @Body() body: UpdateExerciseDto) {
    return this.exercises.update(id, toInput(body));
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('exercises/:id')
  getAdmin(@Param('id') id: string) {
    return this.exercises.getAdmin(id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/exercise/admin')
  getAdminByLesson(@Param('lessonId') lessonId: string) {
    return this.exercises.getAdminByLesson(lessonId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('exercises/:id/verify')
  verify(@Param('id') id: string) {
    return this.exercises.verifyReference(id);
  }

  // ─── Student ────────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @Get('lessons/:lessonId/exercise')
  forStudent(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
  ): Promise<StudentExerciseView> {
    return this.exercises.getForStudent(actor.userId, lessonId);
  }

  @Roles('STUDENT')
  @Post('exercises/:id/run')
  @CodeThrottle()
  run(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: CodeDto,
  ): Promise<RunResult> {
    return this.exercises.run(actor.userId, id, body.code);
  }

  @Roles('STUDENT')
  @Post('exercises/:id/submit')
  @CodeThrottle()
  async submit(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: CodeDto,
    @Req() req: Request,
  ): Promise<SubmitResult> {
    const res = await this.exercises.submit(actor.userId, id, body.code);
    void this.audit.record(actor, {
      action: 'exercise.submit',
      entity: 'Exercise',
      entityId: id,
      diff: {
        verdict: res.verdict,
        scorePct: res.scorePct,
        firstReward: !!res.reward,
      },
      ip: req.ip ?? null,
    });
    return res;
  }

  @Roles('STUDENT')
  @Get('submissions/:id')
  submission(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.exercises.getSubmission(actor.userId, id);
  }
}
