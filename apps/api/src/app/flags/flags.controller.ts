import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import {
  FeatureFlagService,
  type FeatureFlagView,
} from './feature-flag.service.js';
import type { FlagEvaluation } from './flag-evaluation.js';

export class CreateFeatureFlagDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  /** `{ enabled, rolloutPct?, holdoutPct?, variants?, surface? }` — validated by the service. */
  @IsObject()
  value!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateFeatureFlagDto {
  @IsOptional()
  @IsObject()
  value?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export interface FlagsResponse {
  flags: Record<string, FlagEvaluation>;
}

function reqMeta(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/** GET /flags — the caller's evaluated flags (public: 'public' surface only). */
@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FeatureFlagService) {}

  @Public()
  @Get()
  async mine(@Req() req: Request): Promise<FlagsResponse> {
    return { flags: await this.flags.evaluateAll(req.user?.userId ?? null) };
  }
}

/** Admin CRUD for feature flags (docs/04 Settings). Every write is audited. */
@Controller('admin/feature-flags')
export class AdminFlagsController {
  constructor(
    private readonly flags: FeatureFlagService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ADMIN')
  @Get()
  async list(): Promise<{ items: FeatureFlagView[] }> {
    return { items: await this.flags.list() };
  }

  @Roles('ADMIN')
  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() actor: ApiUser,
    @Body() body: CreateFeatureFlagDto,
    @Req() req: Request,
  ): Promise<FeatureFlagView> {
    const flag = await this.flags.create(body.key, body);
    await this.audit.record(actor, {
      action: 'feature_flag.create',
      entity: 'FeatureFlag',
      entityId: flag.key,
      diff: { after: { ...flag } },
      ...reqMeta(req),
    });
    return flag;
  }

  @Roles('ADMIN')
  @Patch(':key')
  async update(
    @CurrentUser() actor: ApiUser,
    @Param('key') key: string,
    @Body() body: UpdateFeatureFlagDto,
    @Req() req: Request,
  ): Promise<FeatureFlagView> {
    const { before, after } = await this.flags.update(key, body);
    await this.audit.record(actor, {
      action: 'feature_flag.update',
      entity: 'FeatureFlag',
      entityId: key,
      diff: {
        before: {
          value: before.value,
          description: before.description,
          isActive: before.isActive,
        },
        after: {
          value: after.value,
          description: after.description,
          isActive: after.isActive,
        },
      },
      ...reqMeta(req),
    });
    return after;
  }

  @Roles('ADMIN')
  @Delete(':key')
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('key') key: string,
    @Req() req: Request,
  ): Promise<{ deleted: true; key: string }> {
    const removed = await this.flags.remove(key);
    await this.audit.record(actor, {
      action: 'feature_flag.delete',
      entity: 'FeatureFlag',
      entityId: key,
      diff: { before: { ...removed } },
      ...reqMeta(req),
    });
    return { deleted: true, key };
  }
}
