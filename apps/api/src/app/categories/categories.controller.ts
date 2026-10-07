import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
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
import { CategoriesService } from './categories.service.js';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  type CategoryListResponse,
  type CategoryResponse,
} from './categories.dto.js';
import { IntRangePipe } from '../common/int-range.pipe.js';

/**
 * Categories CRUD. Reads are open to any authenticated user (so the
 * student catalog can hit the same endpoint when Phase 5e wires it up).
 * Mutations require ADMIN — TEACHERs don't get to invent taxonomy.
 */
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('skip', new DefaultValuePipe(0), new IntRangePipe(0)) skip: number,
    @Query('take', new DefaultValuePipe(50), new IntRangePipe(1, 200))
    take: number,
  ): Promise<CategoryListResponse> {
    return this.categories.list({ skip, take });
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<CategoryResponse> {
    return this.categories.getById(id);
  }

  @Roles('ADMIN')
  @Post()
  async create(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateCategoryDto,
    @Req() req: Request,
  ): Promise<CategoryResponse> {
    const created = await this.categories.create(body);
    void this.audit.record(actor, {
      action: 'category.create',
      entity: 'Category',
      entityId: created.id,
      diff: { ...body },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return created;
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
    @Req() req: Request,
  ): Promise<CategoryResponse> {
    const updated = await this.categories.update(id, body);
    void this.audit.record(actor, {
      action: 'category.update',
      entity: 'Category',
      entityId: id,
      diff: { ...body },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.categories.softDelete(id);
    void this.audit.record(actor, {
      action: 'category.delete',
      entity: 'Category',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }
}
