import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from './users.service.js';
import {
  UpdateMeDto,
  UserListFiltersDto,
  type AdminUserCountry,
  type AdminUserListItem,
  type MeResponse,
} from './users.dto.js';
import { IntRangePipe } from '../common/int-range.pipe.js';
import { UserRoleService } from './user-role.service.js';
import {
  ChangeUserRoleDto,
  type UserRoleChangeResult,
} from './user-role.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** List all users — Admin/Support only. Paginated. */
  @Roles('ADMIN', 'SUPPORT')
  @Get()
  async list(
    @Query('skip', new DefaultValuePipe(0), new IntRangePipe(0)) skip: number,
    @Query('take', new DefaultValuePipe(20), new IntRangePipe(1, 100))
    take: number,
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query() filters: UserListFiltersDto = {},
  ): Promise<{ items: AdminUserListItem[]; total: number }> {
    if (q !== undefined && (typeof q !== 'string' || q.length > 120)) {
      throw new BadRequestException('q must be at most 120 characters');
    }
    if (
      role !== undefined &&
      !(Object.values(UserRole) as string[]).includes(role)
    ) {
      throw new BadRequestException(
        `role must be one of ${Object.values(UserRole).join(', ')}`,
      );
    }
    const lastSeenFrom = filters.lastSeenFrom
      ? new Date(filters.lastSeenFrom)
      : undefined;
    const lastSeenTo = filters.lastSeenTo
      ? new Date(filters.lastSeenTo)
      : undefined;
    if (lastSeenFrom && lastSeenTo && lastSeenFrom > lastSeenTo) {
      throw new BadRequestException('lastSeenFrom must be before lastSeenTo');
    }
    return this.users.listForAdmin({
      skip,
      take,
      q: q || undefined,
      role: role as UserRole | undefined,
      locale: filters.locale || undefined,
      lastSeenFrom,
      lastSeenTo,
      subscriptionStatus: filters.subscriptionStatus,
      ageGroup: filters.ageGroup,
      country: filters.country?.toUpperCase() || undefined,
    });
  }

  /** Countries present among users (Users country filter) — Admin/Support. */
  @Roles('ADMIN', 'SUPPORT')
  @Get('countries')
  countries(): Promise<{ items: AdminUserCountry[] }> {
    return this.users.countriesForAdmin();
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

/**
 * PATCH /admin/users/:id/role — ADMIN only (docs/04 Users, docs/14 §11).
 * 403 ROLE_CHANGE_SELF for your own account; audited `user.role_changed`
 * with `diff.before.role` / `diff.after.role` (+ optional `reason`).
 */
@Controller('admin/users')
export class AdminUserRoleController {
  constructor(private readonly roles: UserRoleService) {}

  @Roles('ADMIN')
  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: ApiUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeUserRoleDto,
  ): Promise<UserRoleChangeResult> {
    return this.roles.changeRole(actor, id, body.role, body.reason);
  }
}
