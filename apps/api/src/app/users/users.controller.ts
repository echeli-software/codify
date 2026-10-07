import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from './users.service.js';
import {
  UpdateMeDto,
  type AdminUserListItem,
  type MeResponse,
} from './users.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** List all users — Admin/Support only. Paginated. */
  @Roles('ADMIN', 'SUPPORT')
  @Get()
  async list(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ): Promise<{ items: AdminUserListItem[]; total: number }> {
    return this.users.listForAdmin({ skip, take: Math.min(take, 100) });
  }

  /** Detail view — Admin/Support only. */
  @Roles('ADMIN', 'SUPPORT')
  @Get(':id')
  detail(@Param('id') id: string): Promise<MeResponse> {
    return this.users.getDetailForAdmin(id);
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** Self read — every authenticated role qualifies. */
  @Get()
  me(@CurrentUser() actor: ApiUser): Promise<MeResponse> {
    return this.users.getById(actor.userId);
  }

  /** Self update — every authenticated role qualifies. */
  @Patch()
  async updateMe(
    @CurrentUser() actor: ApiUser,
    @Body() body: UpdateMeDto,
    @Req() req: Request,
  ): Promise<MeResponse> {
    const updated = await this.users.update(actor.userId, body);
    void this.audit.record(actor, {
      action: 'user.update_self',
      entity: 'User',
      entityId: actor.userId,
      diff: { ...body },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return updated;
  }
}
