import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { EnrollmentsService } from './enrollments.service.js';
import {
  GrantEnrollmentDto,
  type EnrollmentView,
  type MyEnrollment,
} from './enrollments.dto.js';

@Controller()
export class EnrollmentsController {
  constructor(
    private readonly enrollments: EnrollmentsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('STUDENT')
  @Post('courses/:id/enroll')
  @HttpCode(201)
  enroll(
    @CurrentUser() actor: ApiUser,
    @Param('id') courseId: string,
  ): Promise<EnrollmentView> {
    return this.enrollments.enroll(actor, courseId);
  }

  @Roles('STUDENT')
  @Delete('courses/:id/enroll')
  @HttpCode(204)
  unenroll(
    @CurrentUser() actor: ApiUser,
    @Param('id') courseId: string,
  ): Promise<void> {
    return this.enrollments.unenroll(actor, courseId);
  }

  @Roles('STUDENT')
  @Get('me/enrollments')
  mine(@CurrentUser() actor: ApiUser): Promise<MyEnrollment[]> {
    return this.enrollments.listMine(actor);
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get('admin/users/:userId/enrollments')
  forUser(@Param('userId') userId: string): Promise<EnrollmentView[]> {
    return this.enrollments.listForUser(userId);
  }

  @Roles('ADMIN', 'SUPPORT')
  @Post('admin/enrollments')
  @HttpCode(201)
  async grant(
    @CurrentUser() actor: ApiUser,
    @Body() body: GrantEnrollmentDto,
    @Req() req: Request,
  ): Promise<EnrollmentView> {
    const view = await this.enrollments.grant(actor, body);
    void this.audit.record(actor, {
      action: 'enrollment.grant',
      entity: 'Enrollment',
      entityId: view.id,
      diff: {
        userId: body.userId,
        courseId: body.courseId,
        source: body.source,
        accessUntil: body.accessUntil ?? null,
        reason: body.reason ?? null,
      },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return view;
  }

  @Roles('ADMIN', 'SUPPORT')
  @Delete('admin/enrollments/:id')
  async revoke(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<EnrollmentView> {
    const view = await this.enrollments.revoke(actor, id);
    void this.audit.record(actor, {
      action: 'enrollment.revoke',
      entity: 'Enrollment',
      entityId: id,
      diff: { courseId: view.courseId, source: view.source },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return view;
  }
}
