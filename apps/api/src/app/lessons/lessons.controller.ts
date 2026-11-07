import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  CreateLessonDto,
  UpdateLessonDto,
  type LessonOfflineBundle,
  type LessonResponse,
  type LessonVersion,
} from './lessons.dto.js';
import { LessonsService } from './lessons.service.js';

/**
 * Lessons. Create is nested under /api/modules/:moduleId/lessons; everything
 * else uses /api/lessons/:id directly.
 */
@Controller()
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Students: 404 for unpublished courses, 402 `{ reason, requiredPlans }`
   * without content when they lack access, quiz answers stripped otherwise.
   */
  @Get('lessons/:id')
  detail(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<LessonResponse> {
    return this.lessons.getById(actor, id);
  }

  /** Offline download payload (docs/16 §5). Same gating as GET /lessons/:id. */
  @Get('lessons/:id/offline-bundle')
  offlineBundle(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<LessonOfflineBundle> {
    return this.lessons.offlineBundle(actor, id);
  }

  /** `[{ lessonId, updatedAt }]` so downloads re-fetch only changed lessons. */
  @Get('courses/:id/lesson-versions')
  lessonVersions(
    @CurrentUser() actor: ApiUser,
    @Param('id') courseId: string,
  ): Promise<LessonVersion[]> {
    return this.lessons.lessonVersions(actor, courseId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('modules/:moduleId/lessons')
  async create(
    @CurrentUser() actor: ApiUser,
    @Param('moduleId') moduleId: string,
    @Body() body: CreateLessonDto,
    @Req() req: Request,
  ): Promise<LessonResponse> {
    const created = await this.lessons.create(actor, moduleId, body);
    void this.audit.record(actor, {
      action: 'lesson.create',
      entity: 'Lesson',
      entityId: created.id,
      // Don't include the whole contentJson in the audit row — too large
      // for casual review. Just keep the meta fields.
      diff: { ...body, contentJson: undefined, moduleId },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('lessons/:id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateLessonDto,
    @Req() req: Request,
  ): Promise<LessonResponse> {
    const updated = await this.lessons.update(actor, id, body);
    void this.audit.record(actor, {
      action: 'lesson.update',
      entity: 'Lesson',
      entityId: id,
      // Drop contentJson from the audit diff — track that it changed but
      // not the full doc; full history lives in a future revisions table.
      diff: {
        ...body,
        contentJson:
          body.contentJson !== undefined ? '[contentJson]' : undefined,
      },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete('lessons/:id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.lessons.softDelete(actor, id);
    void this.audit.record(actor, {
      action: 'lesson.delete',
      entity: 'Lesson',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }
}
