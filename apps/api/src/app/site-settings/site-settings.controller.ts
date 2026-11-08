import { Body, Controller, Get, Header, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  BRANDING_TOKENS,
  type BrandingSettings,
  type SiteSettings,
} from './site-settings.logic.js';
import { SiteSettingsService } from './site-settings.service.js';

/** PUT /api/admin/site-settings — every field optional. */
export class UpdateSiteSettingsDto {
  /** `{ tokens: { primary: '#…' }, label: 'STAGING' | null }` (validated in the service). */
  @IsOptional()
  @IsObject()
  branding?: BrandingSettings;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledLocales?: string[];
}

export interface SiteSettingsAdminView extends SiteSettings {
  /** Tokens an override may set (`--cdf-color-<token>`). */
  brandingTokens: readonly string[];
}

/**
 * Site settings (docs/04 Settings): branding colour overrides and enabled
 * locales. `GET /site-config` is public (both apps read it at start-up to
 * apply CSS variables and hide disabled locales); editing is ADMIN-only and
 * audited.
 */
@Controller()
export class SiteSettingsController {
  constructor(
    private readonly settings: SiteSettingsService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('site-config')
  @Header('Cache-Control', 'public, max-age=60')
  config(): Promise<SiteSettings> {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Get('admin/site-settings')
  async adminView(): Promise<SiteSettingsAdminView> {
    return { ...(await this.settings.get(0)), brandingTokens: BRANDING_TOKENS };
  }

  @Roles('ADMIN')
  @Put('admin/site-settings')
  async update(
    @CurrentUser() actor: ApiUser,
    @Body() body: UpdateSiteSettingsDto,
    @Req() req: Request,
  ): Promise<SiteSettingsAdminView> {
    const { before, after } = await this.settings.update(body);
    void this.audit.record(actor, {
      action: 'site.settings_update',
      entity: 'SiteSettings',
      diff: { before, after } as unknown as Record<string, unknown>,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
    return { ...after, brandingTokens: BRANDING_TOKENS };
  }
}
