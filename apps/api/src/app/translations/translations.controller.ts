import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Put,
  Query,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ListTranslationsQueryDto,
  ResolveTranslationsQueryDto,
  UpsertTranslationsDto,
} from './translations.dto.js';
import {
  TranslationsService,
  type ResolvedTranslations,
  type TranslationScope,
} from './translations.service.js';
import type {
  CompletenessReport,
  TranslationWorkRow,
} from './translations.logic.js';

const MAX_IDS = 100;

/** Teachers work on their own courses only; admins/support see everything. */
function scopeFor(actor: ApiUser): TranslationScope {
  return actor.role === 'TEACHER' ? { authorId: actor.userId } : {};
}

/**
 * Content translations (docs/11 §3).
 *   GET /api/admin/translations?entityType&locale&status&q&limit&offset — ADMIN, TEACHER (own)
 *   PUT /api/admin/translations { items: [...] }                       — ADMIN, TEACHER (own); audited
 *   GET /api/admin/translations/completeness                            — ADMIN, SUPPORT, TEACHER (own)
 *   GET /api/translations?entityType&ids=a,b&locale&fields=title        — public, cacheable
 */
@Controller()
export class TranslationsController {
  constructor(
    private readonly translations: TranslationsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ADMIN', 'TEACHER')
  @Get('admin/translations')
  list(
    @CurrentUser() actor: ApiUser,
    @Query() query: ListTranslationsQueryDto,
  ): Promise<{ items: TranslationWorkRow[]; total: number }> {
    return this.translations.list(query, scopeFor(actor));
  }

  @Roles('ADMIN', 'TEACHER', 'SUPPORT')
  @Get('admin/translations/completeness')
  completeness(@CurrentUser() actor: ApiUser): Promise<CompletenessReport> {
    return this.translations.completeness(scopeFor(actor));
  }

  @Roles('ADMIN', 'TEACHER')
  @Put('admin/translations')
  async upsert(
    @CurrentUser() actor: ApiUser,
    @Body() body: UpsertTranslationsDto,
  ): Promise<{ updated: number }> {
    const { updated, before } = await this.translations.upsert(
      body.items,
      scopeFor(actor),
    );
    void this.audit.record(actor, {
      action: 'translation.upsert',
      entity: 'ContentTranslation',
      diff: {
        before,
        after: Object.fromEntries(
          body.items.map((i) => [
            `${i.entityType}:${i.entityId}:${i.locale}:${i.field}`,
            i.value,
          ]),
        ),
      },
    });
    return { updated };
  }

  @Public()
  @Get('translations')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  resolve(
    @Query() query: ResolveTranslationsQueryDto,
  ): Promise<ResolvedTranslations> {
    const ids = [
      ...new Set(
        query.ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) throw new BadRequestException('ids is required');
    if (ids.length > MAX_IDS)
      throw new BadRequestException(`At most ${MAX_IDS} ids`);
    const fields = query.fields
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.translations.resolve(
      query.entityType,
      ids,
      query.locale,
      fields,
    );
  }
}
