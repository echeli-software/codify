import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { CoursesService } from './courses.service.js';
import {
  CreateCourseDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
  type CourseDetail,
  type CourseListItem,
  type CourseListResponse,
} from './courses.dto.js';

const DEFAULT_LOCALE = 'pt-BR';

function pickLocale(header: string | undefined): string {
  if (!header) return DEFAULT_LOCALE;
  // Accept-Language: "en-US,en;q=0.9" → "en-US"
  const first = header.split(',')[0]?.trim();
  return first || DEFAULT_LOCALE;
}

/**
 * Course CRUD. All reads are visible to STUDENTs (filtered to PUBLISHED
 * server-side); writes require ADMIN or TEACHER (the latter scoped to
 * their own courses, enforced inside the service).
 *
 * Title + description are stored in ContentTranslation rows with the
 * source-locale on POST. The Accept-Language header lets the response
 * resolve title in the caller's preferred locale and falls back to
 * source.
 */
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @CurrentUser() actor: ApiUser,
    @Query() query: ListCoursesQueryDto,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<CourseListResponse> {
    // Teachers only ever list their own courses — a foreign authorId in
    // the query is ignored. Staff above teacher may filter freely.
    const scopedQuery: ListCoursesQueryDto =
      actor.role === 'TEACHER' ? { ...query, authorId: actor.userId } : query;
    return this.courses.list(actor, scopedQuery, pickLocale(acceptLanguage));
  }

  @Get(':idOrSlug')
  detail(
    @CurrentUser() actor: ApiUser,
    @Param('idOrSlug') idOrSlug: string,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<CourseDetail> {
    return this.courses.getDetail(actor, idOrSlug, pickLocale(acceptLanguage));
  }

  @Roles('ADMIN', 'TEACHER')
  @Post()
  async create(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateCourseDto,
    @Req() req: Request,
  ): Promise<CourseListItem> {
    const created = await this.courses.create(actor, body);
    void this.audit.record(actor, {
      action: 'course.create',
      entity: 'Course',
      entityId: created.id,
      diff: { ...body },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch(':id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateCourseDto,
    @Req() req: Request,
  ): Promise<CourseListItem> {
    const updated = await this.courses.update(actor, id, body);
    void this.audit.record(actor, {
      action: 'course.update',
      entity: 'Course',
      entityId: id,
      diff: { ...body },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/publish')
  async publish(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<CourseListItem> {
    const updated = await this.courses.publish(actor, id);
    void this.audit.record(actor, {
      action: 'course.publish',
      entity: 'Course',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/archive')
  async archive(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<CourseListItem> {
    const updated = await this.courses.archive(actor, id);
    void this.audit.record(actor, {
      action: 'course.archive',
      entity: 'Course',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.courses.softDelete(actor, id);
    void this.audit.record(actor, {
      action: 'course.delete',
      entity: 'Course',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }
}
