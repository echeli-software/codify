import {
  Body,
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
import {
  CompleteLessonDto,
  type CompleteLessonResponse,
  type CourseProgressResponse,
} from './progress.dto.js';

/**
 * Lesson completions + per-course progress view.
 *
 *   POST /api/lessons/:id/complete  — record completion (STUDENT only).
 *     Body (optional): { clientTimestamp?: ISO-8601 } — offline queue time;
 *       400 (code CLIENT_TIMESTAMP_IN_FUTURE / _TOO_OLD) when > 5 min ahead
 *       or > 72 h old.
 *     - 201 on first completion
 *     - 409 code LESSON_ALREADY_COMPLETED on replay (original progress + totals)
 *     - 409 code LESSON_COMPLETES_VIA_OWN_FLOW for EXERCISE / AI_PROMPT /
 *       SCENARIO / CAPSTONE lessons, QUIZ_REQUIRES_GRADING for QUIZ lessons
 *       with quiz blocks
 *     - 404 if lesson missing / course not PUBLISHED
 *     - 402 if lesson is paid and the student has no entitlement
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
    @Body() body: CompleteLessonDto,
    @Req() req: Request,
  ): Promise<CompleteLessonResponse> {
    // Service throws ConflictException on duplicate so the controller
    // path here only runs for first-time completions — keeping the
    // 201 + audit-emission semantics clean.
    const { progress, totals, reward, questsCompleted, badgesUnlocked } =
      await this.progress.complete(actor, lessonId, {
        clientTimestamp: body?.clientTimestamp,
      });
    void this.audit.record(actor, {
      action: 'lesson.complete',
      entity: 'Lesson',
      entityId: lessonId,
      diff: {
        xpAwarded: progress.xpAwarded,
        coinsAwarded: progress.coinsAwarded,
        multiplier: reward?.multiplier ?? 1,
        questsCompleted: questsCompleted?.length ?? 0,
        badgesUnlocked: badgesUnlocked?.length ?? 0,
      },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return { progress, totals, reward, questsCompleted, badgesUnlocked };
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
