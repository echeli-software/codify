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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { CreateModuleDto, UpdateModuleDto, type ModuleResponse } from './modules.dto.js';
import { ModulesService } from './modules.service.js';

const DEFAULT_LOCALE = 'pt-BR';
function pickLocale(h: string | undefined): string {
  return (h?.split(',')[0]?.trim()) || DEFAULT_LOCALE;
}

/**
 * Modules — nested under /api/courses/:courseId/modules for create + list,
 * direct /api/modules/:id for update + delete. Two-route shape mirrors
 * REST conventions: writes that need a parent context use the nested
 * path; mutations of an existing resource use the resource's own id.
 */
@Controller()
export class ModulesController {
  constructor(
    private readonly modules: ModulesService,
    private readonly audit: AuditService,
  ) {}

  @Get('courses/:courseId/modules')
  list(
    @CurrentUser() actor: ApiUser,
    @Param('courseId') courseId: string,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<ModuleResponse[]> {
    return this.modules.listForCourse(actor, courseId, pickLocale(acceptLanguage));
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('courses/:courseId/modules')
  async create(
    @CurrentUser() actor: ApiUser,
    @Param('courseId') courseId: string,
    @Body() body: CreateModuleDto,
    @Req() req: Request,
  ): Promise<ModuleResponse> {
    const created = await this.modules.create(actor, courseId, body);
    void this.audit.record(actor, {
      action: 'module.create',
      entity: 'Module',
      entityId: created.id,
      diff: { ...body, courseId },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return created;
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('modules/:id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateModuleDto,
    @Req() req: Request,
  ): Promise<ModuleResponse> {
    const updated = await this.modules.update(actor, id, body);
    void this.audit.record(actor, {
      action: 'module.update',
      entity: 'Module',
      entityId: id,
      diff: { ...body },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete('modules/:id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.modules.remove(actor, id);
    void this.audit.record(actor, {
      action: 'module.delete',
      entity: 'Module',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }
}
