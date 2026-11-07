/**
 * Pure logic for the content-translation workspace (docs/11 §3): which
 * fields are translatable per entity, how rows/completeness are derived from
 * entities + ContentTranslation rows, and locale fallback resolution.
 */

/**
 * Supported content locales — mirrors `SUPPORTED_LOCALES` in libs/i18n
 * (kept here because the API must not import the Angular i18n library).
 * Adding a locale: add it in libs/i18n and here.
 */
export const SUPPORTED_LOCALES = ['pt-BR', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'pt-BR';

export function isSupportedLocale(v: unknown): v is SupportedLocale {
  return (
    typeof v === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(v)
  );
}

export const TRANSLATABLE_ENTITIES = [
  'COURSE',
  'MODULE',
  'LESSON',
  'CATEGORY',
  'PLAN',
  'BADGE',
  'ITEM',
  'ITEM_CATEGORY',
  'QUEST',
] as const;
export type TranslatableEntityType = (typeof TRANSLATABLE_ENTITIES)[number];

/** Translatable fields per entity type (docs/11 §3). */
export const TRANSLATABLE_FIELDS: Record<
  TranslatableEntityType,
  readonly string[]
> = {
  COURSE: ['title', 'description'],
  MODULE: ['title'],
  LESSON: ['title', 'contentJson'],
  CATEGORY: ['name', 'description'],
  PLAN: ['name', 'description', 'tagline'],
  BADGE: ['name', 'description'],
  ITEM: ['name', 'description'],
  ITEM_CATEGORY: ['name'],
  QUEST: ['title'],
};

/** Fields the public batch-resolve endpoint may return (no paywalled body). */
export const PUBLIC_FIELDS: Record<TranslatableEntityType, readonly string[]> =
  {
    COURSE: ['title', 'description'],
    MODULE: ['title'],
    LESSON: ['title'],
    CATEGORY: ['name', 'description'],
    PLAN: ['name', 'description', 'tagline'],
    BADGE: ['name', 'description'],
    ITEM: ['name', 'description'],
    ITEM_CATEGORY: ['name'],
    QUEST: ['title'],
  };

/** Normalize a locale tag to a supported locale ("en" / "en-GB" → "en-US"). */
export function matchSupportedLocale(
  tag: string | null | undefined,
): SupportedLocale | null {
  const t = tag?.split(';')[0]?.trim();
  if (!t) return null;
  const exact = SUPPORTED_LOCALES.find(
    (l) => l.toLowerCase() === t.toLowerCase(),
  );
  if (exact) return exact;
  const lang = t.split('-')[0].toLowerCase();
  return (
    SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${lang}-`)) ??
    null
  );
}

/**
 * The locale a request asks for, before the caller's stored locale is
 * consulted: an explicit `?locale=` wins, then the first Accept-Language
 * tag that maps onto a supported locale. Null = not stated.
 */
export function explicitRequestLocale(
  queryLocale: unknown,
  acceptLanguage: string | null | undefined,
): SupportedLocale | null {
  if (typeof queryLocale === 'string') {
    const q = matchSupportedLocale(queryLocale);
    if (q) return q;
  }
  for (const tag of (acceptLanguage ?? '').split(',')) {
    const m = matchSupportedLocale(tag);
    if (m) return m;
  }
  return null;
}

/** One entity's source values for {@link localizeValues}. */
export interface LocalizableEntity {
  id: string;
  /** Locale of `values`; defaults to `DEFAULT_LOCALE` (column-sourced). */
  sourceLocale?: string;
  /** Source text per translatable field; null/'' = nothing to translate. */
  values: Record<string, string | null | undefined>;
}

export interface LocalizeGroup {
  entityType: TranslatableEntityType;
  items: readonly LocalizableEntity[];
}

export const localizedKey = (
  entityType: string,
  entityId: string,
  field: string,
) => `${entityType}\u0000${entityId}\u0000${field}`;

export interface LocalizedValues {
  /** `localizedKey(type, id, field)` → translation in the requested locale. */
  values: Map<string, string>;
  /**
   * Source locale of the first field that had source text but no
   * translation in the requested locale (→ `X-Translation-Fallback`).
   */
  fallbackFrom: string | null;
}

/**
 * Resolve a response's translatable text: the requested locale's
 * ContentTranslation row when present and non-empty, otherwise the source
 * value (which is then a fallback, unless the source is already in the
 * requested locale). `rows` should hold the requested locale's rows only.
 */
export function localizeValues(
  groups: readonly LocalizeGroup[],
  rows: readonly Pick<
    TranslationRowLike,
    'entityType' | 'entityId' | 'locale' | 'field' | 'value'
  >[],
  locale: string,
): LocalizedValues {
  const found = new Map<string, string>();
  for (const r of rows) {
    if (r.locale !== locale || !r.value) continue;
    found.set(localizedKey(r.entityType, r.entityId, r.field), r.value);
  }
  const values = new Map<string, string>();
  let fallbackFrom: string | null = null;
  for (const g of groups) {
    const fields = TRANSLATABLE_FIELDS[g.entityType];
    for (const e of g.items) {
      const source = e.sourceLocale ?? DEFAULT_LOCALE;
      if (source === locale) continue;
      for (const field of fields) {
        const sourceValue = e.values[field];
        if (sourceValue == null || sourceValue === '') continue;
        const k = localizedKey(g.entityType, e.id, field);
        const t = found.get(k);
        if (t != null) values.set(k, t);
        else fallbackFrom ??= source;
      }
    }
  }
  return { values, fallbackFrom };
}

/** An entity with its source locale and source-locale field values. */
export interface SourceEntity {
  entityType: TranslatableEntityType;
  entityId: string;
  sourceLocale: string;
  /** Human label for the admin list (usually the source title/name). */
  label: string;
  /** Source values; null/'' = nothing to translate for that field. */
  sourceValues: Record<string, string | null>;
}

export interface TranslationRowLike {
  entityType: string;
  entityId: string;
  locale: string;
  field: string;
  value: string;
  outdated: boolean;
  updatedAt: Date;
}

export type TranslationStatus = 'missing' | 'outdated' | 'done';

export interface TranslationWorkRow {
  entityType: TranslatableEntityType;
  entityId: string;
  label: string;
  field: string;
  sourceLocale: string;
  sourceValue: string;
  locale: string;
  value: string | null;
  outdated: boolean;
  status: TranslationStatus;
  updatedAt: string | null;
}

const key = (entityId: string, locale: string, field: string) =>
  `${entityId}\u0000${locale}\u0000${field}`;

/**
 * One row per (entity, translatable field with a source value, target
 * locale ≠ the entity's source locale), joined with its translation.
 */
export function buildWorkRows(
  entities: SourceEntity[],
  translations: TranslationRowLike[],
  locales: readonly string[],
): TranslationWorkRow[] {
  const byKey = new Map(
    translations.map((t) => [key(t.entityId, t.locale, t.field), t]),
  );
  const rows: TranslationWorkRow[] = [];
  for (const e of entities) {
    for (const field of TRANSLATABLE_FIELDS[e.entityType]) {
      const sourceValue = e.sourceValues[field];
      if (sourceValue == null || sourceValue === '') continue;
      for (const locale of locales) {
        if (locale === e.sourceLocale) continue;
        const t = byKey.get(key(e.entityId, locale, field));
        const value = t?.value ?? null;
        const outdated = !!t && t.outdated;
        rows.push({
          entityType: e.entityType,
          entityId: e.entityId,
          label: e.label,
          field,
          sourceLocale: e.sourceLocale,
          sourceValue,
          locale,
          value,
          outdated,
          status:
            value == null || value === ''
              ? 'missing'
              : outdated
                ? 'outdated'
                : 'done',
          updatedAt: t?.updatedAt.toISOString() ?? null,
        });
      }
    }
  }
  return rows;
}

export function filterWorkRows(
  rows: TranslationWorkRow[],
  opts: { status?: TranslationStatus; q?: string },
): TranslationWorkRow[] {
  const q = opts.q?.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!opts.status || r.status === opts.status) &&
      (!q ||
        r.entityId.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.sourceValue.toLowerCase().includes(q) ||
        (r.value ?? '').toLowerCase().includes(q)),
  );
}

export interface CompletenessCounts {
  total: number;
  /** Up-to-date translations (present and not outdated). */
  translated: number;
  /** Present but flagged outdated (source changed since). */
  outdated: number;
  /** translated / total, 0–100 (100 when there's nothing to translate). */
  pct: number;
}

function counts(rows: TranslationWorkRow[]): CompletenessCounts {
  const total = rows.length;
  const translated = rows.filter((r) => r.status === 'done').length;
  const outdated = rows.filter((r) => r.status === 'outdated').length;
  return {
    total,
    translated,
    outdated,
    pct: total === 0 ? 100 : Math.round((translated / total) * 1000) / 10,
  };
}

export interface CompletenessReport {
  locales: Record<
    string,
    Record<string, CompletenessCounts> & { ALL: CompletenessCounts }
  >;
  entities: (CompletenessCounts & {
    entityType: TranslatableEntityType;
    entityId: string;
    label: string;
    locale: string;
  })[];
}

/** Per-locale × entity-type totals plus a per-entity breakdown. */
export function buildCompleteness(
  rows: TranslationWorkRow[],
  locales: readonly string[],
): CompletenessReport {
  const report: CompletenessReport = { locales: {}, entities: [] };
  for (const locale of locales) {
    const forLocale = rows.filter((r) => r.locale === locale);
    const perType = {} as Record<string, CompletenessCounts>;
    for (const type of TRANSLATABLE_ENTITIES) {
      perType[type] = counts(forLocale.filter((r) => r.entityType === type));
    }
    report.locales[locale] = { ...perType, ALL: counts(forLocale) };

    const byEntity = new Map<string, TranslationWorkRow[]>();
    for (const r of forLocale) {
      const k = `${r.entityType}:${r.entityId}`;
      const list = byEntity.get(k) ?? [];
      list.push(r);
      byEntity.set(k, list);
    }
    for (const list of byEntity.values()) {
      const first = list[0];
      report.entities.push({
        entityType: first.entityType,
        entityId: first.entityId,
        label: first.label,
        locale,
        ...counts(list),
      });
    }
  }
  return report;
}

export interface ResolvedField {
  value: string | null;
  /** Locale the value came from. */
  locale: string | null;
  /** True when the value is not in the requested locale. */
  fallback: boolean;
}

/**
 * Resolve one field: requested locale → entity source locale → app default
 * (docs/11 §3 "Resolution order").
 */
export function resolveField(
  entity: SourceEntity,
  field: string,
  locale: string,
  translations: Map<string, TranslationRowLike>,
): ResolvedField {
  const candidates = [locale, entity.sourceLocale, DEFAULT_LOCALE].filter(
    (l, i, a) => a.indexOf(l) === i,
  );
  for (const l of candidates) {
    let value: string | null | undefined;
    if (l === entity.sourceLocale) value = entity.sourceValues[field];
    else value = translations.get(key(entity.entityId, l, field))?.value;
    if (value != null && value !== '')
      return { value, locale: l, fallback: l !== locale };
  }
  return { value: null, locale: null, fallback: false };
}

export function translationIndex(
  translations: TranslationRowLike[],
): Map<string, TranslationRowLike> {
  return new Map(
    translations.map((t) => [key(t.entityId, t.locale, t.field), t]),
  );
}
