import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
  async complete(
    @CurrentUser() actor: ApiUser,
    @Param('id') lessonId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompleteLessonResponse> {
    const { wasNew, progress, totals } = await this.progress.complete(
      actor,
      lessonId,
    );
    res.status(wasNew ? 201 : 200);

    if (wasNew) {
      void this.audit.record(actor, {
        action: 'lesson.complete',
        entity: 'Lesson',
        entityId: lessonId,
        diff: { xpAwarded: progress.xpAwarded, coinsAwarded: progress.coinsAwarded },
        ip: req.ip ?? null,
        userAgent: (req.headers['user-agent'] as string) ?? null,
      });
    }
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
