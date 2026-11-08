import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { IntRangePipe } from '../common/int-range.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BulkCoursesDto,
  CurriculumOrderDto,
  FreeLessonsDto,
  type BulkCoursesResponse,
  type CourseAuthorView,
} from './course-admin.dto.js';
import {
  CourseInsightsService,
  type CourseAnalyticsReport,
  type CourseEnrollmentRow,
  type CourseMultiplierRow,
  type CourseTranslationsReport,
} from './course-insights.service.js';
import { CoursesService } from './courses.service.js';
import {
  CurriculumService,
  type CurriculumOrderResult,
  type DuplicateLessonResult,
  type FreeLessonsResult,
} from './curriculum.service.js';

function meta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Course editor operations beyond CRUD (docs/04 Catalog → Courses / Course):
 * bulk actions, curriculum reorder / duplicate / free set, and the
 * Translations, Analytics, Promotions and enrollments tabs. ADMIN, or a
 * TEACHER on their own courses; every mutation is audited.
 */
@Controller()
export class CourseAdminController {
  constructor(
    private readonly courses: CoursesService,
    private readonly curriculum: CurriculumService,
    private readonly insights: CourseInsightsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Authors for the courses-list filter (TEACHER: only themselves). */
  @Roles('ADMIN', 'SUPPORT', 'TEACHER')
  @Get('admin/course-authors')
  async authors(@CurrentUser() actor: ApiUser): Promise<CourseAuthorView[]> {
    const groups = await this.prisma.course.groupBy({
      by: ['authorId'],
      where: {
        deletedAt: null,
        ...(actor.role === 'TEACHER' ? { authorId: actor.userId } : {}),
      },
      _count: { _all: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: groups.map((g) => g.authorId) } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return groups
      .map((g) => ({
        id: g.authorId,
        displayName: names.get(g.authorId) ?? g.authorId,
        courseCount: g._count._all,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('courses/bulk')
  @HttpCode(200)
  async bulk(
    @CurrentUser() actor: ApiUser,
    @Body() body: BulkCoursesDto,
    @Req() req: Request,
  ): Promise<BulkCoursesResponse> {
    const ids = [...new Set(body.ids)];
    const updated: string[] = [];
    const failed: BulkCoursesResponse['failed'] = [];
    for (const id of ids) {
      try {
        if (body.action === 'publish') await this.courses.publish(actor, id);
        else if (body.action === 'archive')
          await this.courses.archive(actor, id);
        else
          await this.courses.update(actor, id, {
            categoryIds: body.categoryIds ?? [],
          });
        updated.push(id);
        void this.audit.record(actor, {
          action:
            body.action === 'publish'
              ? 'course.publish'
              : body.action === 'archive'
                ? 'course.archive'
                : 'course.update',
          entity: 'Course',
          entityId: id,
          diff: {
            bulk: true,
            ...(body.action === 'setCategories'
              ? { categoryIds: body.categoryIds ?? [] }
              : {}),
          },
          ...meta(req),
        });
      } catch (err) {
        failed.push({
          id,
          status: err instanceof HttpException ? err.getStatus() : 500,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { action: body.action, updated, failed };
  }

  @Roles('ADMIN', 'TEACHER')
  @Put('courses/:id/curriculum/order')
  async reorder(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: CurriculumOrderDto,
    @Req() req: Request,
  ): Promise<CurriculumOrderResult> {
    const res = await this.curriculum.reorder(actor, id, body.modules);
    void this.audit.record(actor, {
      action: 'course.curriculum_reorder',
      entity: 'Course',
      entityId: id,
      diff: { modules: body.modules },
      ...meta(req),
    });
    return res;
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('courses/:id/lessons/:lessonId/duplicate')
  async duplicate(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
    @Req() req: Request,
  ): Promise<DuplicateLessonResult> {
    const res = await this.curriculum.duplicateLesson(actor, id, lessonId);
    void this.audit.record(actor, {
      action: 'lesson.duplicate',
      entity: 'Lesson',
      entityId: res.id,
      diff: { sourceLessonId: lessonId, courseId: id, copied: res.copied },
      ...meta(req),
    });
    return res;
  }

  @Roles('ADMIN', 'TEACHER')
  @Put('courses/:id/free-lessons')
  async freeLessons(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: FreeLessonsDto,
    @Req() req: Request,
  ): Promise<FreeLessonsResult> {
    const res = await this.curriculum.setFreeLessons(actor, id, body.lessonIds);
    void this.audit.record(actor, {
      action: 'course.free_lessons',
      entity: 'Course',
      entityId: id,
      diff: {
        before: res.previousFreeLessonIds,
        after: res.freeLessonIds,
      },
      ...meta(req),
    });
    return res;
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('courses/:id/translations')
  translations(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<CourseTranslationsReport> {
    return this.insights.translations(actor, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get('courses/:id/analytics')
  analytics(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<CourseAnalyticsReport> {
    return this.insights.analytics(actor, id);
  }

  /** docs/04 §1: TEACHER sees anonymised enrollments of own courses. */
  @Roles('ADMIN', 'TEACHER')
  @Get('courses/:id/enrollments')
  enrollments(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Query('skip', new DefaultValuePipe(0), new IntRangePipe(0)) skip: number,
    @Query('take', new DefaultValuePipe(50), new IntRangePipe(1, 200))
    take: number,
  ): Promise<{ items: CourseEnrollmentRow[]; total: number }> {
    return this.insights.enrollments(actor, id, { skip, take });
  }

  /** docs/04 §1: TEACHER views own course-level multipliers (read-only). */
  @Roles('ADMIN', 'TEACHER')
  @Get('courses/:id/multipliers')
  multipliers(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<CourseMultiplierRow[]> {
    return this.insights.multipliers(actor, id);
  }
}
