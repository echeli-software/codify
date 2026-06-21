import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { BadgesService, type BadgeRule, type BadgeView } from './badges.service.js';
import { CreateBadgeDto, UpdateBadgeDto } from './badges.dto.js';

/**
 * Badges.
 *   GET  /api/badges          — the caller's badges (earned + visible unearned)
 *   GET  /api/badges/manage   — ADMIN: full list incl. hidden/inactive
 *   POST/PATCH/DELETE /badges — ADMIN: manage badge definitions
 */
@Controller('badges')
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

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
  create(@Body() body: CreateBadgeDto) {
    return this.badges.createBadge({ ...body, rule: body.rule as unknown as BadgeRule });
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateBadgeDto) {
    return this.badges.updateBadge(id, { ...body, rule: body.rule as unknown as BadgeRule | undefined });
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.badges.deleteBadge(id);
  }
}
