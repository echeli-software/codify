import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TestCase } from '@codify/domain';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ExercisesService,
  type ExerciseInput,
  type RunResult,
  type StudentExerciseView,
} from './exercises.service.js';
import {
  SubmissionsService,
  type SubmissionView,
} from './submissions.service.js';
import {
  CodeDto,
  CreateExerciseDto,
  UpdateExerciseDto,
} from './exercises.dto.js';
import { RetryAfterInterceptor } from './rate-limit.js';
import { CodeThrottle } from '../common/throttling/throttle.decorators.js';

function toInput(
  dto: CreateExerciseDto | UpdateExerciseDto,
): Partial<ExerciseInput> {
  return {
    ...dto,
    visibleTests: dto.visibleTests as unknown as TestCase[] | undefined,
    hiddenTests: dto.hiddenTests as unknown as TestCase[] | undefined,
  };
}

/**
 * Coding exercises (docs/12).
 *
 * Admin (ADMIN, or a TEACHER on their own course):
 *   POST  /lessons/:lessonId/exercise        create + attach
 *   PATCH /exercises/:id                     update
 *   GET   /exercises/:id                     full exercise incl. solution + hidden tests
 *   GET   /lessons/:lessonId/exercise/admin  same, by lesson (null when none)
 *   POST  /exercises/:id/verify              run the reference solution on all tests
 *
 * Student:
 *   GET   /lessons/:lessonId/exercise        starter code + visible tests
 *   POST  /exercises/:id/run                 visible tests only, synchronous
 *   POST  /exercises/:id/submit              visible + hidden; honours Idempotency-Key;
 *                                            201 + full result when graded within ~10 s,
 *                                            else 202 { submissionId, status: 'PENDING' }
 *   GET   /submissions/:id                   poll a submission
 */
@Controller()
export class ExercisesController {
  constructor(
    private readonly exercises: ExercisesService,
    private readonly submissions: SubmissionsService,
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
      actor,
      lessonId,
      toInput(body) as ExerciseInput,
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
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateExerciseDto,
    @Req() req: Request,
  ) {
    const updated = await this.exercises.update(actor, id, toInput(body));
    void this.audit.record(actor, {
      action: 'exercise.update',
      entity: 'Exercise',
      entityId: id,
      diff: { fields: Object.keys(body) },
      ip: req.ip ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('exercises/:id')
  getAdmin(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.exercises.getAdmin(actor, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/exercise/admin')
  getAdminByLesson(
    @CurrentUser() actor: ApiUser,
    @Param('lessonId') lessonId: string,
  ) {
    return this.exercises.getAdminByLesson(actor, lessonId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('exercises/:id/verify')
  verify(@CurrentUser() actor: ApiUser, @Param('id') id: string) {
    return this.exercises.verifyReference(actor, id);
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

  @CodeThrottle()
  @Roles('STUDENT')
  @Post('exercises/:id/run')
  run(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: CodeDto,
  ): Promise<RunResult> {
    return this.exercises.run(actor.userId, id, body.code);
  }

  @CodeThrottle()
  @Roles('STUDENT')
  @Post('exercises/:id/submit')
  @UseInterceptors(RetryAfterInterceptor)
  async submit(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: CodeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmissionView> {
    const view = await this.submissions.submit(
      actor.userId,
      id,
      body.code,
      idempotencyKey,
    );
    const done = view.status === 'COMPLETE' || view.status === 'WORKER_LOST';
    if (!done) res.status(202);
    void this.audit.record(actor, {
      action: 'exercise.submit',
      entity: 'Exercise',
      entityId: id,
      diff: {
        submissionId: view.submissionId,
        status: view.status,
        verdict: view.verdict,
        scorePct: view.scorePct,
        firstReward: !!view.reward,
      },
      ip: req.ip ?? null,
    });
    return view;
  }

  @Roles('STUDENT')
  @Get('submissions/:id')
  submission(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<SubmissionView> {
    return this.submissions.get(actor.userId, id);
  }
}
