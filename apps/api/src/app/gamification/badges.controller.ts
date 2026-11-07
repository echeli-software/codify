import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  BadgesService,
  type BadgeRule,
  type BadgeView,
} from './badges.service.js';
import { CreateBadgeDto, UpdateBadgeDto } from './badges.dto.js';

/**
 * Badges.
 *   GET    /api/badges          — the caller's badges (earned + visible unearned)
 *   GET    /api/badges/manage   — ADMIN: full list incl. hidden/inactive
 *   POST   /api/badges          — ADMIN: create (rule validated)
 *   PATCH  /api/badges/:id      — ADMIN: edit any field incl. slug + rule
 *   DELETE /api/badges/:id      — ADMIN: deactivate
 * Admin mutations are audited.
 */
@Controller('badges')
export class BadgesController {
  constructor(
    private readonly badges: BadgesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  mine(@CurrentUser() actor: ApiUser): Promise<BadgeView[]> {
    return this.badges.listForUser(actor.userId);
  }

  @Roles('ADMIN')
  @Get('manage')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.badges.listBadges(includeInactive === 'true');
  }

  @Roles('ADMIN')
  @Post()
  async create(@CurrentUser() actor: ApiUser, @Body() body: CreateBadgeDto) {
    const created = await this.badges.createBadge({
      ...body,
      rule: body.rule as unknown as BadgeRule,
    });
    void this.audit.record(actor, {
      action: 'badge.create',
      entity: 'Badge',
      entityId: created.id,
      diff: { ...body },
    });
    return created;
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateBadgeDto,
  ) {
    const updated = await this.badges.updateBadge(id, {
      ...body,
      rule: body.rule as unknown as BadgeRule | undefined,
    });
    void this.audit.record(actor, {
      action: 'badge.update',
      entity: 'Badge',
      entityId: id,
      diff: { ...body },
    });
    return updated;
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.badges.deleteBadge(id);
    void this.audit.record(actor, {
      action: 'badge.delete',
      entity: 'Badge',
      entityId: id,
    });
  }
}
