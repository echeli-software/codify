import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  GamificationConfigService,
  type ConfigEntryView,
} from './gamification-config.service.js';

/**
 * Admin "Settings → Gamification defaults" (docs/07 §2).
 *   GET /api/admin/gamification/config — every known key, value + default
 *   PUT /api/admin/gamification/config — { "<key>": value | null, … }
 *       (null resets to default). Validated per key; audited.
 */
@Controller('admin/gamification/config')
@Roles('ADMIN')
export class GamificationConfigController {
  constructor(
    private readonly config: GamificationConfigService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(): Promise<ConfigEntryView[]> {
    return this.config.list();
  }

  @Put()
  async update(
    @CurrentUser() actor: ApiUser,
    @Body() body: Record<string, unknown>,
  ): Promise<ConfigEntryView[]> {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Body must be an object of key → value');
    const { entries, before } = await this.config.update(body);
    void this.audit.record(actor, {
      action: 'gamification.config.update',
      entity: 'GamificationConfig',
      diff: { before, after: body },
    });
    return entries;
  }
}
