import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkTranslatedBody } from '../lessons/lesson-content.js';
import {
  parseImportFile,
  toCsv,
  toJsonExport,
  type ImportRowError,
  type TranslationFileFormat,
} from './translations-io.js';
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
 * 400 `INVALID_TRANSLATIONS`: `detail` joins the problems, `problems` lists
 * them (one per item / lesson-body issue).
 */
function invalidTranslations(errors: string[]): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_TRANSLATIONS',
    message: errors.join('; '),
    errors,
  });
}

/** One translation to mark complete (POST /admin/translations/complete). */
export interface TranslationRef {
  entityType: TranslatableEntityType;
  entityId: string;
  field: string;
  locale: string;
}

export interface TranslationImportReport {
  dryRun: boolean;
  /** Rows written (0 on a dry run or when any row has an error). */
  imported: number;
  /** Rows that would be / were written. */
  valid: number;
  /** Rows left alone: empty translatedValue or unchanged value. */
  skipped: number;
  errors: ImportRowError[];
  /** Rows whose `sourceValue` no longer matches the current source (imported, kept outdated). */
  sourceChanged: { row: number; entityId: string; field: string }[];
}

interface CheckedItem extends TranslationUpsert {
  /** Value to store (contentJson: the validated, re-serialised doc). */
  stored: string;
  entity: SourceEntity;
  /** Index of the item in the checked list. */
  index: number;
}

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
    const { checked, errors } = await this.checkItems(items, scope);
    if (errors.length) throw invalidTranslations(errors);

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
      checked.map((it) =>
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
            value: it.stored,
          },
          update: { value: it.stored, outdated: false },
        }),
      ),
    );
    return { updated: items.length, before };
  }

  /**
   * Validate upserts without writing: supported locale, known field,
   * existing entity in scope, never the source locale; lesson bodies must
   * be valid LessonDocs with the source's block structure (docs/11 §3,
   * FIX-6). `errors` are human-readable, prefixed with `items[i]`.
   */
  private async checkItems(
    items: TranslationUpsert[],
    scope?: TranslationScope,
    label: (i: number) => string = (i) => `items[${i}]`,
  ): Promise<{ checked: CheckedItem[]; errors: string[] }> {
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
    const checked: CheckedItem[] = [];
    items.forEach((it, i) => {
      const at = label(i);
      const before = errors.length;
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
      let stored = it.value;
      if (it.field === 'contentJson') {
        if (it.value.length > MAX_CONTENT_JSON)
          errors.push(`${at}.value is too large`);
        else if (entity) {
          const source = entity.sourceValues['contentJson'];
          let sourceDoc: unknown = null;
          try {
            sourceDoc = source ? JSON.parse(source) : null;
          } catch {
            /* unreadable source → structure check reports it */
          }
          const result = checkTranslatedBody(sourceDoc, it.value);
          if (result.ok) stored = JSON.stringify(result.doc);
          else
            for (const issue of result.issues)
              errors.push(
                `${at}.value${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`,
              );
        }
      }
      if (errors.length === before && entity)
        checked.push({ ...it, stored, entity, index: i });
    });
    return { checked, errors };
  }

  // ─── Mark complete (docs/11 §3 editor flow) ─────────────────────────────

  /**
   * Explicit "mark complete": clears `outdated` on existing, non-empty
   * translations without changing their text (the translator checked the
   * text still fits the new source). Lesson bodies are re-validated against
   * the CURRENT source structure first. All-or-nothing.
   */
  async markComplete(
    items: TranslationRef[],
    scope?: TranslationScope,
  ): Promise<{ completed: number; keys: string[] }> {
    if (items.length === 0)
      throw new BadRequestException('No translations to mark complete');
    const rows = await this.prisma.contentTranslation.findMany({
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
    const errors: string[] = [];
    const upserts: TranslationUpsert[] = [];
    items.forEach((it, i) => {
      const row = rows.find(
        (r) =>
          r.entityType === it.entityType &&
          r.entityId === it.entityId &&
          r.locale === it.locale &&
          r.field === it.field,
      );
      if (!row || !row.value)
        errors.push(`items[${i}]: there is no translation to mark complete`);
      else upserts.push({ ...it, value: row.value });
    });
    if (errors.length) throw invalidTranslations(errors);
    const { errors: invalid } = await this.checkItems(upserts, scope);
    if (invalid.length) throw invalidTranslations(invalid);
    await this.prisma.$transaction(
      upserts.map((it) =>
        this.prisma.contentTranslation.update({
          where: {
            entityType_entityId_locale_field: {
              entityType: it.entityType,
              entityId: it.entityId,
              locale: it.locale,
              field: it.field,
            },
          },
          data: { outdated: false },
        }),
      ),
    );
    const keys = upserts.map(
      (it) => `${it.entityType}:${it.entityId}:${it.locale}:${it.field}`,
    );
    return { completed: upserts.length, keys };
  }

  // ─── Bulk export / import (docs/11 §3) ──────────────────────────────────

  /** Every translatable row of one entity type for one target locale. */
  async exportFile(
    entityType: TranslatableEntityType,
    locale: string,
    format: TranslationFileFormat,
    scope?: TranslationScope,
  ): Promise<{ filename: string; contentType: string; body: string }> {
    const entities = await this.loadEntities(
      entityType,
      undefined,
      true,
      scope,
    );
    const translations = await this.loadTranslations(
      entityType,
      entities.map((e) => e.entityId),
    );
    const rows = buildWorkRows(entities, translations, [locale]);
    const base = `translations-${entityType.toLowerCase()}-${locale}`;
    return format === 'csv'
      ? {
          filename: `${base}.csv`,
          contentType: 'text/csv; charset=utf-8',
          body: toCsv(rows),
        }
      : {
          filename: `${base}.json`,
          contentType: 'application/json; charset=utf-8',
          body: toJsonExport(entityType, locale, rows),
        };
  }

  /**
   * Import a CSV / JSON file for one entity type + locale. Every row is
   * validated (locale = the chosen one, known entity in scope, translatable
   * field, never the source locale, lesson bodies valid + structure-locked);
   * rows with an empty `translatedValue` or an unchanged value are skipped.
   * Nothing is written when any row has an error, or on `dryRun`. The
   * `sourceValue` column is informational and NEVER written; when it no
   * longer matches the current source the row is imported but stays
   * flagged outdated.
   */
  async importFile(
    input: {
      entityType: TranslatableEntityType;
      locale: string;
      format: TranslationFileFormat;
      content: string;
      dryRun?: boolean;
    },
    scope?: TranslationScope,
  ): Promise<{
    report: TranslationImportReport;
    before: Record<string, string | null>;
  }> {
    const { rows, errors } = parseImportFile(input.format, input.content);
    const report: TranslationImportReport = {
      dryRun: !!input.dryRun,
      imported: 0,
      valid: 0,
      skipped: 0,
      errors,
      sourceChanged: [],
    };
    const candidates = rows.filter((r) => {
      if (r.locale && r.locale !== input.locale) {
        errors.push({
          row: r.row,
          entityId: r.entityId,
          field: r.field,
          message: `locale "${r.locale}" does not match the import locale ${input.locale}`,
        });
        return false;
      }
      if (r.translatedValue.trim() === '') {
        report.skipped++;
        return false;
      }
      return true;
    });
    const seen = new Set<string>();
    for (const r of candidates) {
      const k = `${r.entityId}\u0000${r.field}`;
      if (seen.has(k))
        errors.push({
          row: r.row,
          entityId: r.entityId,
          field: r.field,
          message: 'Duplicate row for this entity and field',
        });
      seen.add(k);
    }
    const items: TranslationUpsert[] = candidates.map((r) => ({
      entityType: input.entityType,
      entityId: r.entityId,
      field: r.field,
      locale: input.locale,
      value: r.translatedValue,
    }));
    const { checked, errors: itemErrors } = await this.checkItems(
      items,
      scope,
      (i) => `row ${candidates[i].row}`,
    );
    for (const message of itemErrors) {
      const m = /^row (\d+)/.exec(message);
      const row = m ? Number(m[1]) : 0;
      const c = candidates.find((x) => x.row === row);
      errors.push({ row, entityId: c?.entityId, field: c?.field, message });
    }
    errors.sort((a, b) => a.row - b.row);

    const existing = checked.length
      ? await this.prisma.contentTranslation.findMany({
          where: {
            entityType: input.entityType,
            locale: input.locale,
            entityId: { in: [...new Set(checked.map((c) => c.entityId))] },
          },
          select: { entityId: true, field: true, value: true, outdated: true },
        })
      : [];
    const current = (c: CheckedItem) =>
      existing.find((e) => e.entityId === c.entityId && e.field === c.field);
    const writes: (CheckedItem & { outdated: boolean })[] = [];
    for (const c of checked) {
      const row = candidates[c.index];
      const prev = current(c);
      const src = c.entity.sourceValues[c.field] ?? '';
      const sourceKnown = row?.sourceValue != null;
      const sourceChanged = sourceKnown && row.sourceValue !== src;
      // Unchanged text is only re-written to clear `outdated` when the file
      // shows the translator worked from the current source.
      if (
        prev &&
        prev.value === c.stored &&
        !(prev.outdated && sourceKnown && !sourceChanged)
      ) {
        report.skipped++;
        continue;
      }
      if (sourceChanged)
        report.sourceChanged.push({
          row: row?.row ?? 0,
          entityId: c.entityId,
          field: c.field,
        });
      writes.push({ ...c, outdated: sourceChanged });
    }
    report.valid = writes.length;
    const before: Record<string, string | null> = {};
    if (errors.length || input.dryRun || writes.length === 0)
      return { report, before };

    for (const w of writes)
      before[`${w.entityType}:${w.entityId}:${w.locale}:${w.field}`] =
        current(w)?.value ?? null;
    await this.prisma.$transaction(
      writes.map((w) =>
        this.prisma.contentTranslation.upsert({
          where: {
            entityType_entityId_locale_field: {
              entityType: w.entityType,
              entityId: w.entityId,
              locale: w.locale,
              field: w.field,
            },
          },
          create: {
            entityType: w.entityType,
            entityId: w.entityId,
            locale: w.locale,
            field: w.field,
            value: w.stored,
            outdated: w.outdated,
          },
          update: { value: w.stored, outdated: w.outdated },
        }),
      ),
    );
    report.imported = writes.length;
    return { report, before };
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
   * own `sourceLocale`; modules/lessons inherit their course's. Categories,
   * plans, badges, items, item categories (id = slug) and quest templates
   * keep their source text in their own columns, in the default locale.
   * `includeBody` = staff workspace (all rows); false = public resolver
   * (active, non-hidden rows only).
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
      case 'PLAN': {
        if (scope?.authorId) return [];
        const rows = await this.prisma.plan.findMany({
          where: {
            deletedAt: null,
            ...(includeBody ? {} : { isActive: true }),
            ...idFilter,
          },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            tagline: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
        });
        return rows.map((p) =>
          columnEntity(type, p.id, p.name || p.slug, {
            name: p.name,
            description: p.description,
            tagline: p.tagline,
          }),
        );
      }
      case 'BADGE': {
        if (scope?.authorId) return [];
        // The public resolver never reveals hidden/inactive badges.
        const rows = await this.prisma.badge.findMany({
          where: {
            ...(includeBody ? {} : { isActive: true, isHidden: false }),
            ...idFilter,
          },
          select: { id: true, slug: true, name: true, description: true },
          orderBy: { slug: 'asc' },
        });
        return rows.map((b) =>
          columnEntity(type, b.id, b.name || b.slug, {
            name: b.name,
            description: b.description,
          }),
        );
      }
      case 'ITEM': {
        if (scope?.authorId) return [];
        const rows = await this.prisma.item.findMany({
          where: {
            deletedAt: null,
            ...(includeBody ? {} : { isActive: true }),
            ...idFilter,
          },
          select: { id: true, slug: true, name: true, description: true },
          orderBy: { slug: 'asc' },
        });
        return rows.map((i) =>
          columnEntity(type, i.id, i.name || i.slug, {
            name: i.name,
            description: i.description,
          }),
        );
      }
      case 'ITEM_CATEGORY': {
        if (scope?.authorId) return [];
        const rows = await this.prisma.itemCategory.findMany({
          where: ids ? { slug: { in: ids } } : {},
          select: { slug: true, name: true },
          orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
        });
        return rows.map((c) =>
          columnEntity(type, c.slug, c.name || c.slug, { name: c.name }),
        );
      }
      case 'QUEST': {
        if (scope?.authorId) return [];
        const rows = await this.prisma.questTemplate.findMany({
          where: {
            ...(includeBody ? {} : { isActive: true }),
            ...idFilter,
          },
          select: { id: true, slug: true, title: true },
          orderBy: [{ difficulty: 'asc' }, { slug: 'asc' }],
        });
        return rows.map((q) =>
          columnEntity(type, q.id, q.title || q.slug, { title: q.title }),
        );
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
          where: {
            deletedAt: null,
            course: { deletedAt: null, ...authorFilter },
            ...idFilter,
          },
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
            module: {
              deletedAt: null,
              course: { deletedAt: null, ...authorFilter },
            },
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

/** An entity whose source text is its own columns, in `DEFAULT_LOCALE`. */
function columnEntity(
  entityType: TranslatableEntityType,
  entityId: string,
  label: string,
  sourceValues: Record<string, string | null>,
): SourceEntity {
  return {
    entityType,
    entityId,
    sourceLocale: DEFAULT_LOCALE,
    label,
    sourceValues,
  };
}
