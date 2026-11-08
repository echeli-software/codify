import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { RewardThrottle } from '../common/throttling/throttle.decorators.js';
import { PromoCodesService } from './promo-codes.service.js';
import {
  CreatePromoCodeDto,
  RedeemPromoCodeDto,
  UpdatePromoCodeDto,
  type PromoCodeView,
  type RedeemPromoCodeResponse,
} from './promo-codes.dto.js';

/**
 * Coin promo codes (docs/08 §12).
 *   GET    /api/admin/promo-codes          — ADMIN
 *   POST   /api/admin/promo-codes          — ADMIN, audited promo_code.create
 *   PATCH  /api/admin/promo-codes/:id      — ADMIN, audited promo_code.update
 *   DELETE /api/admin/promo-codes/:id      — ADMIN, audited promo_code.delete
 *          (a redeemed code is deactivated instead of deleted)
 */
@Controller('admin/promo-codes')
@Roles('ADMIN')
export class PromoCodesAdminController {
  constructor(
    private readonly promo: PromoCodesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(): Promise<PromoCodeView[]> {
    return this.promo.list();
  }

  @Post()
  async create(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreatePromoCodeDto,
  ): Promise<PromoCodeView> {
    const created = await this.promo.create(body);
    void this.audit.record(actor, {
      action: 'promo_code.create',
      entity: 'PromoCode',
      entityId: created.id,
      diff: { ...body, code: created.code },
    });
    return created;
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
    @Body() body: UpdatePromoCodeDto,
  ): Promise<PromoCodeView> {
    const updated = await this.promo.update(id, body);
    void this.audit.record(actor, {
      action: 'promo_code.update',
      entity: 'PromoCode',
      entityId: id,
      diff: { ...body },
    });
    return updated;
  }

  @Delete(':id')
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    const res = await this.promo.remove(id);
    void this.audit.record(actor, {
      action: 'promo_code.delete',
      entity: 'PromoCode',
      entityId: id,
      diff: res,
    });
    return res;
  }
}

/**
 *   POST /api/me/promo-codes/redeem  { code } — STUDENT. Once per user,
 *   case-insensitive, inside the code's window and redemption limit.
 *   200 { code, coins, totals }; 404 PROMO_CODE_NOT_FOUND, 400
 *   PROMO_CODE_NOT_STARTED, 410 PROMO_CODE_EXPIRED, 409
 *   PROMO_CODE_ALREADY_REDEEMED / PROMO_CODE_EXHAUSTED, 429
 *   PROMO_CODE_RATE_LIMITED (10 failed tries / hour) — plus the reward
 *   throttle (10 / min).
 */
@Controller('me/promo-codes')
export class PromoCodesController {
  constructor(private readonly promo: PromoCodesService) {}

  @Roles('STUDENT')
  @RewardThrottle()
  @Post('redeem')
  @HttpCode(200)
  redeem(
    @CurrentUser() actor: ApiUser,
    @Body() body: RedeemPromoCodeDto,
  ): Promise<RedeemPromoCodeResponse> {
    return this.promo.redeem(actor.userId, body.code);
  }
}
