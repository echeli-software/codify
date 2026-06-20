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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { PlansService } from './plans.service.js';
import {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanPriceInputDto,
  UpdatePlanDto,
  type PlanListResponse,
  type PlanResponse,
} from './plans.dto.js';

/**
 * Plan catalog. Reads are open to any authenticated user (the student
 * paywall + course-detail chips list active plans, optionally filtered to
 * plans-including-a-course). All mutations + Stripe sync are ADMIN only.
 */
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @CurrentUser() actor: ApiUser,
    @Query() query: ListPlansQueryDto,
  ): Promise<PlanListResponse> {
    const includeInactive = isStaff(actor) && query.includeInactive === 'true';
    return this.plans.list(query, { includeInactive });
  }

  @Get(':id')
  detail(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<PlanResponse> {
    return this.plans.getById(id, { includeInactive: isStaff(actor) });
  }

  @Roles('ADMIN')
  @Post()
  async create(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreatePlanDto,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const created = await this.plans.create(body);
    void this.audit.record(actor, auditMeta('plan.create', created.id, { ...body }, req));
    return created;
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdatePlanDto,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const updated = await this.plans.update(id, body);
    void this.audit.record(actor, auditMeta('plan.update', id, { ...body }, req));
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
    await this.plans.softDelete(id);
    void this.audit.record(actor, auditMeta('plan.delete', id, null, req));
  }

  @Roles('ADMIN')
  @Post(':id/prices')
  async addPrice(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: PlanPriceInputDto,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const updated = await this.plans.addPrice(id, body);
    void this.audit.record(actor, auditMeta('plan.price.add', id, { ...body }, req));
    return updated;
  }

  @Roles('ADMIN')
  @Delete(':id/prices/:priceId')
  async removePrice(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Param('priceId') priceId: string,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const updated = await this.plans.removePrice(id, priceId);
    void this.audit.record(actor, auditMeta('plan.price.remove', id, { priceId }, req));
    return updated;
  }

  @Roles('ADMIN')
  @Post(':id/sync-stripe')
  async sync(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<PlanResponse> {
    const synced = await this.plans.syncToStripe(id);
    void this.audit.record(
      actor,
      auditMeta('plan.sync_stripe', id, { stripeProductId: synced.stripeProductId }, req),
    );
    return synced;
  }
}

function isStaff(actor: ApiUser): boolean {
  return actor.role === 'ADMIN' || actor.role === 'TEACHER' || actor.role === 'SUPPORT';
}

function auditMeta(
  action: string,
  entityId: string,
  diff: Record<string, unknown> | null,
  req: Request,
) {
  return {
    action,
    entity: 'Plan',
    entityId,
    diff,
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}
