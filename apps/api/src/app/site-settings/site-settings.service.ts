import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SITE_SETTING_KEYS,
  coerceSettings,
  validateBranding,
  validateEnabledLocales,
  type BrandingSettings,
  type SiteSettings,
} from './site-settings.logic.js';

const CACHE_MS = 30_000;

/**
 * Environment-level site settings (docs/04 Settings): branding colour
 * overrides and enabled locales. Stored as two rows of the GamificationConfig
 * key/value table (`site.branding`, `site.locales`), so each environment's
 * database holds its own values; the gamification config endpoints never
 * list these keys. Reads are cached for 30 s per process.
 */
@Injectable()
export class SiteSettingsService {
  private cache: { at: number; value: SiteSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(now = Date.now()): Promise<SiteSettings> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.gamificationConfig.findMany({
      where: { key: { in: Object.values(SITE_SETTING_KEYS) } },
    });
    const by = new Map(rows.map((r) => [r.key, r.value]));
    const value = coerceSettings({
      branding: by.get(SITE_SETTING_KEYS.branding) ?? undefined,
      locales: by.get(SITE_SETTING_KEYS.locales) ?? undefined,
    });
    this.cache = { at: now, value };
    return value;
  }

  /** Validate + store; returns the settings before and after (audit diff). */
  async update(patch: {
    branding?: BrandingSettings;
    enabledLocales?: string[];
  }): Promise<{ before: SiteSettings; after: SiteSettings }> {
    const problems = [
      ...(patch.branding !== undefined ? validateBranding(patch.branding) : []),
      ...(patch.enabledLocales !== undefined
        ? validateEnabledLocales(patch.enabledLocales)
        : []),
    ];
    if (problems.length)
      throw new BadRequestException({
        code: 'INVALID_SITE_SETTINGS',
        message: `Invalid settings: ${problems.join('; ')}`,
        errors: problems,
      });
    const before = await this.get(0);
    const writes: [string, Prisma.InputJsonValue][] = [];
    if (patch.branding !== undefined)
      writes.push([
        SITE_SETTING_KEYS.branding,
        {
          tokens: patch.branding.tokens ?? {},
          label: patch.branding.label?.trim() || null,
        } as unknown as Prisma.InputJsonValue,
      ]);
    if (patch.enabledLocales !== undefined)
      writes.push([
        SITE_SETTING_KEYS.locales,
        [...new Set(patch.enabledLocales)],
      ]);
    await this.prisma.$transaction(
      writes.map(([key, value]) =>
        this.prisma.gamificationConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    this.cache = null;
    return { before, after: await this.get() };
  }
}
