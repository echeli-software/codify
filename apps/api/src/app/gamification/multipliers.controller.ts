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
  MultipliersService,
  multiplierAuditSnapshot,
  type MultiplierResponse,
} from './multipliers.service.js';
import {
  CreateMultiplierDto,
  ListMultipliersQueryDto,
  UpdateMultiplierDto,
} from './multipliers.dto.js';

/**
 * Admin CRUD for Multiplier rows (promotions / premium / streak tiers).
 *   GET    /api/multipliers?active=now&kind=  — ADMIN (Promotions screen)
 *   GET    /api/multipliers/active            — any signed-in user: the
 *          promos/campaigns running now (catalog badges, campaign banner)
 *   POST/PATCH/DELETE /api/multipliers[/:id]  — ADMIN, audited
 */
@Controller('multipliers')
@Roles('ADMIN')
export class MultipliersController {
  constructor(
    private readonly multipliers: MultipliersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: ListMultipliersQueryDto): Promise<MultiplierResponse[]> {
    return this.multipliers.list(query);
  }

  @Roles()
  @Get('active')
  active(): Promise<MultiplierResponse[]> {
    return this.multipliers.list({ active: 'now' });
  }

  @Post()
  async create(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateMultiplierDto,
  ): Promise<MultiplierResponse> {
    const created = await this.multipliers.create(body);
    void this.audit.record(actor, {
      action: 'multiplier.create',
      entity: 'Multiplier',
      entityId: created.id,
      after: multiplierAuditSnapshot(created),
    });
    return created;
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdateMultiplierDto,
  ): Promise<MultiplierResponse> {
    const { before, after } = await this.multipliers.update(id, body);
    void this.audit.record(actor, {
      action: 'multiplier.update',
      entity: 'Multiplier',
      entityId: id,
      before: multiplierAuditSnapshot(before),
      after: multiplierAuditSnapshot(after),
    });
    return after;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<void> {
    const removed = await this.multipliers.remove(id);
    void this.audit.record(actor, {
      action: 'multiplier.delete',
      entity: 'Multiplier',
      entityId: id,
      before: multiplierAuditSnapshot(removed),
    });
  }
}
