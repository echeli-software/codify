import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  ExportTranslationsQueryDto,
  ImportTranslationsDto,
  ListTranslationsQueryDto,
  MarkTranslationsCompleteDto,
  ResolveTranslationsQueryDto,
  UpsertTranslationsDto,
} from './translations.dto.js';
import {
  TranslationsService,
  type ResolvedTranslations,
  type TranslationImportReport,
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
 *   POST /api/admin/translations/complete { items: [ref] }               — ADMIN, TEACHER (own); audited
 *   GET /api/admin/translations/export?entityType&locale&format=csv|json — ADMIN, TEACHER (own)
 *   POST /api/admin/translations/import { entityType, locale, format, content, dryRun } — ADMIN, TEACHER (own); audited
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

  /** Explicit "mark complete" (docs/11 §3): clears `outdated`, keeps the text. */
  @Roles('ADMIN', 'TEACHER')
  @Post('admin/translations/complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() actor: ApiUser,
    @Body() body: MarkTranslationsCompleteDto,
  ): Promise<{ completed: number }> {
    const { completed, keys } = await this.translations.markComplete(
      body.items,
      scopeFor(actor),
    );
    void this.audit.record(actor, {
      action: 'translation.completed',
      entity: 'ContentTranslation',
      diff: { before: { outdated: true }, after: { outdated: false }, keys },
    });
    return { completed };
  }

  /** CSV / JSON download of one entity type × locale (attachment). */
  @Roles('ADMIN', 'TEACHER')
  @Get('admin/translations/export')
  async export(
    @CurrentUser() actor: ApiUser,
    @Query() query: ExportTranslationsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await this.translations.exportFile(
      query.entityType,
      query.locale,
      query.format ?? 'csv',
      scopeFor(actor),
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return file.body;
  }

  /**
   * Bulk import. 200 with the report when every row is valid, and always on
   * a dry run (a preview: nothing is written); otherwise 400 problem `TRANSLATION_IMPORT_INVALID` with the same report
   * (`report.errors[]` per row) when any row is not — nothing is written.
   */
  @Roles('ADMIN', 'TEACHER')
  @Post('admin/translations/import')
  @HttpCode(200)
  async import(
    @CurrentUser() actor: ApiUser,
    @Body() body: ImportTranslationsDto,
  ): Promise<TranslationImportReport> {
    const { report, before } = await this.translations.importFile(
      body,
      scopeFor(actor),
    );
    if (report.errors.length > 0 && !body.dryRun) {
      throw new BadRequestException({
        code: 'TRANSLATION_IMPORT_INVALID',
        message: `${report.errors.length} row(s) could not be imported`,
        report,
      });
    }
    if (report.imported > 0) {
      void this.audit.record(actor, {
        action: 'translation.import',
        entity: 'ContentTranslation',
        diff: {
          entityType: body.entityType,
          locale: body.locale,
          format: body.format,
          imported: report.imported,
          before,
        },
      });
    }
    return report;
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
