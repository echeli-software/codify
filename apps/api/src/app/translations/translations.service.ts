import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildCompleteness,
  buildWorkRows,
  DEFAULT_LOCALE,
  filterWorkRows,
  PUBLIC_FIELDS,
  resolveField,
  SUPPORTED_LOCALES,
  TRANSLATABLE_ENTITIES,
  TRANSLATABLE_FIELDS,
  translationIndex,
  type CompletenessReport,
  type ResolvedField,
  type SourceEntity,
  type TranslatableEntityType,
  type TranslationRowLike,
  type TranslationStatus,
  type TranslationWorkRow,
} from './translations.logic.js';

export interface TranslationUpsert {
  entityType: TranslatableEntityType;
  entityId: string;
  field: string;
  locale: string;
  value: string;
}

export interface ListTranslationsQuery {
  entityType?: TranslatableEntityType;
  locale?: string;
  status?: TranslationStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ResolvedTranslations {
  entityType: TranslatableEntityType;
  locale: string;
  items: Record<string, Record<string, ResolvedField>>;
}

/** Restricts the workspace to one author's courses (TEACHER callers). */
export interface TranslationScope {
  authorId?: string;
}

const MAX_CONTENT_JSON = 512 * 1024;

/**
 * Content translation workspace (docs/11 §3): the admin list of
 * source/target pairs with missing/outdated status, bulk upsert, a
 * completeness report, and a public batch resolver with source fallback.
 */
@Injectable()
export class TranslationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListTranslationsQuery,
    scope?: TranslationScope,
  ): Promise<{ items: TranslationWorkRow[]; total: number }> {
    const types = query.entityType
      ? [query.entityType]
      : [...TRANSLATABLE_ENTITIES];
    const locales = query.locale ? [query.locale] : [...SUPPORTED_LOCALES];
    const rows: TranslationWorkRow[] = [];
    for (const type of types) {
      const entities = await this.loadEntities(type, undefined, true, scope);
      const translations = await this.loadTranslations(
        type,
        entities.map((e) => e.entityId),
      );
      rows.push(...buildWorkRows(entities, translations, locales));
    }
    const filtered = filterWorkRows(rows, { status: query.status, q: query.q });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  async completeness(scope?: TranslationScope): Promise<CompletenessReport> {
    const rows: TranslationWorkRow[] = [];
    for (const type of TRANSLATABLE_ENTITIES) {
      const entities = await this.loadEntities(type, undefined, true, scope);
      const translations = await this.loadTranslations(
        type,
        entities.map((e) => e.entityId),
      );
      rows.push(...buildWorkRows(entities, translations, SUPPORTED_LOCALES));
    }
    return buildCompleteness(rows, SUPPORTED_LOCALES);
  }

  /**
   * Upsert one or many translations (clears `outdated`). All-or-nothing:
   * every item is validated (supported locale, known field, existing
   * entity, not the entity's source locale) before anything is written.
   */
  async upsert(
    items: TranslationUpsert[],
    scope?: TranslationScope,
  ): Promise<{ updated: number; before: Record<string, string | null> }> {
    if (items.length === 0)
      throw new BadRequestException('No translations to save');
    const errors: string[] = [];
    const byType = new Map<TranslatableEntityType, Map<string, SourceEntity>>();
    for (const type of new Set(items.map((i) => i.entityType))) {
      const ids = [
        ...new Set(
          items.filter((i) => i.entityType === type).map((i) => i.entityId),
        ),
      ];
      const entities = await this.loadEntities(type, ids, true, scope);
      byType.set(type, new Map(entities.map((e) => [e.entityId, e])));
    }
    items.forEach((it, i) => {
      const at = `items[${i}]`;
      if (!(SUPPORTED_LOCALES as readonly string[]).includes(it.locale))
        errors.push(
          `${at}.locale must be one of ${SUPPORTED_LOCALES.join(', ')}`,
        );
      if (!TRANSLATABLE_FIELDS[it.entityType]?.includes(it.field))
        errors.push(
          `${at}.field must be one of ${TRANSLATABLE_FIELDS[it.entityType]?.join(', ')}`,
        );
      const entity = byType.get(it.entityType)?.get(it.entityId);
      if (!entity)
        errors.push(`${at}: ${it.entityType} ${it.entityId} not found`);
      else if (entity.sourceLocale === it.locale)
        errors.push(
          `${at}: ${it.locale} is the source locale — edit the ${it.entityType.toLowerCase()} itself`,
        );
      if (it.field === 'contentJson') {
        if (it.value.length > MAX_CONTENT_JSON)
          errors.push(`${at}.value is too large`);
        else {
          try {
            JSON.parse(it.value);
          } catch {
            errors.push(`${at}.value must be JSON for contentJson`);
          }
        }
      }
    });
    if (errors.length) throw new BadRequestException(errors);

    const existing = await this.prisma.contentTranslation.findMany({
      where: {
        OR: items.map((it) => ({
          entityType: it.entityType,
          entityId: it.entityId,
          locale: it.locale,
          field: it.field,
        })),
      },
      select: {
        entityType: true,
        entityId: true,
        locale: true,
        field: true,
        value: true,
      },
    });
    const before: Record<string, string | null> = {};
    for (const it of items) {
      const k = `${it.entityType}:${it.entityId}:${it.locale}:${it.field}`;
      before[k] =
        existing.find(
          (e) =>
            e.entityType === it.entityType &&
            e.entityId === it.entityId &&
            e.locale === it.locale &&
            e.field === it.field,
        )?.value ?? null;
    }

    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.contentTranslation.upsert({
          where: {
            entityType_entityId_locale_field: {
              entityType: it.entityType,
              entityId: it.entityId,
              locale: it.locale,
              field: it.field,
            },
          },
          create: {
            entityType: it.entityType,
            entityId: it.entityId,
            locale: it.locale,
            field: it.field,
            value: it.value,
          },
          update: { value: it.value, outdated: false },
        }),
      ),
    );
    return { updated: items.length, before };
  }

  /** Public batch resolve with requested → source → default fallback. */
  async resolve(
    entityType: TranslatableEntityType,
    ids: string[],
    locale: string,
    fields?: string[],
  ): Promise<ResolvedTranslations> {
    const allowed = PUBLIC_FIELDS[entityType];
    const wanted = fields?.length ? fields : [...allowed];
    const bad = wanted.filter((f) => !allowed.includes(f));
    if (bad.length)
      throw new BadRequestException(
        `Unknown or non-public fields: ${bad.join(', ')}`,
      );
    const entities = await this.loadEntities(entityType, ids, false);
    const translations = await this.loadTranslations(
      entityType,
      entities.map((e) => e.entityId),
      wanted,
    );
    const index = translationIndex(translations);
    const items: ResolvedTranslations['items'] = {};
    for (const e of entities) {
      items[e.entityId] = {};
      for (const f of wanted)
        items[e.entityId][f] = resolveField(e, f, locale, index);
    }
    return { entityType, locale, items };
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  private loadTranslations(
    entityType: TranslatableEntityType,
    ids: string[],
    fields?: string[],
  ): Promise<TranslationRowLike[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.contentTranslation.findMany({
      where: {
        entityType,
        entityId: { in: ids },
        ...(fields ? { field: { in: fields } } : {}),
      },
      select: {
        entityType: true,
        entityId: true,
        locale: true,
        field: true,
        value: true,
        outdated: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Entities of one type with their source locale + source values. Courses
   * own `sourceLocale`; modules/lessons inherit their course's; categories
   * keep name/description on the row in the default locale.
   */
  private async loadEntities(
    type: TranslatableEntityType,
    ids?: string[],
    includeBody = true,
    scope?: TranslationScope,
  ): Promise<SourceEntity[]> {
    const idFilter = ids ? { id: { in: ids } } : {};
    // Teachers see/translate their own courses only (docs/04 §1).
    const authorFilter = scope?.authorId ? { authorId: scope.authorId } : {};
    switch (type) {
      case 'CATEGORY': {
        if (scope?.authorId) return [];
        const rows = await this.prisma.category.findMany({
          where: { deletedAt: null, ...idFilter },
          select: { id: true, slug: true, name: true, description: true },
          orderBy: { slug: 'asc' },
        });
        return rows.map((c) => ({
          entityType: type,
          entityId: c.id,
          sourceLocale: DEFAULT_LOCALE,
          label: c.name || c.slug,
          sourceValues: { name: c.name, description: c.description },
        }));
      }
      case 'COURSE': {
        const rows = await this.prisma.course.findMany({
          where: { deletedAt: null, ...authorFilter, ...idFilter },
          select: { id: true, slug: true, sourceLocale: true },
          orderBy: { createdAt: 'asc' },
        });
        return this.withSourceTitles(
          type,
          rows.map((c) => ({
            id: c.id,
            sourceLocale: c.sourceLocale,
            fallbackLabel: c.slug,
          })),
          ['title', 'description'],
        );
      }
      case 'MODULE': {
        const rows = await this.prisma.module.findMany({
          where: { course: { deletedAt: null, ...authorFilter }, ...idFilter },
          select: {
            id: true,
            order: true,
            course: { select: { sourceLocale: true, slug: true } },
          },
          orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
        });
        return this.withSourceTitles(
          type,
          rows.map((m) => ({
            id: m.id,
            sourceLocale: m.course.sourceLocale,
            fallbackLabel: `${m.course.slug} · module ${m.order}`,
          })),
          ['title'],
        );
      }
      case 'LESSON': {
        const rows = await this.prisma.lesson.findMany({
          where: {
            deletedAt: null,
            module: { course: { deletedAt: null, ...authorFilter } },
            ...idFilter,
          },
          select: {
            id: true,
            order: true,
            contentJson: includeBody,
            module: {
              select: {
                course: { select: { sourceLocale: true, slug: true } },
              },
            },
          },
          orderBy: [{ moduleId: 'asc' }, { order: 'asc' }],
        });
        const entities = await this.withSourceTitles(
          type,
          rows.map((l) => ({
            id: l.id,
            sourceLocale: l.module.course.sourceLocale,
            fallbackLabel: `${l.module.course.slug} · lesson ${l.order}`,
          })),
          ['title'],
        );
        if (includeBody) {
          const body = new Map(rows.map((l) => [l.id, l.contentJson]));
          for (const e of entities) {
            const json = body.get(e.entityId);
            e.sourceValues['contentJson'] =
              json == null ? null : JSON.stringify(json);
          }
        }
        return entities;
      }
    }
  }

  private async withSourceTitles(
    type: TranslatableEntityType,
    rows: { id: string; sourceLocale: string; fallbackLabel: string }[],
    fields: string[],
  ): Promise<SourceEntity[]> {
    if (rows.length === 0) return [];
    const source = await this.prisma.contentTranslation.findMany({
      where: {
        entityType: type,
        entityId: { in: rows.map((r) => r.id) },
        field: { in: fields },
      },
      select: { entityId: true, locale: true, field: true, value: true },
    });
    return rows.map((r) => {
      const sourceValues: Record<string, string | null> = {};
      for (const f of fields) {
        sourceValues[f] =
          source.find(
            (s) =>
              s.entityId === r.id &&
              s.field === f &&
              s.locale === r.sourceLocale,
          )?.value ?? null;
      }
      return {
        entityType: type,
        entityId: r.id,
        sourceLocale: r.sourceLocale,
        label: sourceValues['title'] || r.fallbackLabel,
        sourceValues,
      };
    });
  }
}
