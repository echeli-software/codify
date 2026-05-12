import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { ProgressService } from './progress.service.js';
import type {
  CompleteLessonResponse,
  CourseProgressResponse,
} from './progress.dto.js';

/**
 * Lesson completions + per-course progress view.
 *
 *   POST /api/lessons/:id/complete  — record completion (STUDENT only).
 *     - 201 on first completion
 *     - 200 on idempotent replay (same row returned)
 *     - 404 if lesson missing / course not PUBLISHED
 *     - 402 if lesson is paid and the student has no entitlement
 *       (Phase 6 will replace this with Enrollment-aware logic).
 *
 *   GET  /api/courses/:id/progress  — list this user's completions in
 *     that course, plus totalLessons / completedLessons.
 */
@Controller()
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly audit: AuditService,
  ) {}

  @Roles('STUDENT')
  @Post('lessons/:id/complete')
  @HttpCode(201)
  async complete(
    @CurrentUser() actor: ApiUser,
    @Param('id') lessonId: string,
    @Req() req: Request,
  ): Promise<CompleteLessonResponse> {
    // Service throws ConflictException on duplicate so the controller
    // path here only runs for first-time completions — keeping the
    // 201 + audit-emission semantics clean.
    const { progress, totals } = await this.progress.complete(actor, lessonId);
    void this.audit.record(actor, {
      action: 'lesson.complete',
      entity: 'Lesson',
      entityId: lessonId,
      diff: { xpAwarded: progress.xpAwarded, coinsAwarded: progress.coinsAwarded },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return { progress, totals };
  }

  @Get('courses/:id/progress')
  @HttpCode(200)
  list(
    @CurrentUser() actor: ApiUser,
    @Param('id') courseId: string,
  ): Promise<CourseProgressResponse> {
    return this.progress.forCourse(actor, courseId);
  }
}
