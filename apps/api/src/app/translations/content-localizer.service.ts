import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  currentTranslationContext,
  noteTranslationFallback,
} from './translation-context.js';
import {
  DEFAULT_LOCALE,
  explicitRequestLocale,
  isSupportedLocale,
  localizedKey,
  localizeValues,
  TRANSLATABLE_FIELDS,
  type LocalizeGroup,
  type TranslatableEntityType,
} from './translations.logic.js';

/** The translations of one response, resolved for one locale. */
export class Localized {
  constructor(
    readonly locale: string,
    private readonly values: ReadonlyMap<string, string>,
    /** Source locale text fell back to, or null when fully translated. */
    readonly fallbackFrom: string | null,
  ) {}

  /** The translation in `locale`, or `source` when there is none. */
  text<T extends string | null | undefined>(
    entityType: TranslatableEntityType,
    entityId: string,
    field: string,
    source: T,
  ): string | T {
    return this.values.get(localizedKey(entityType, entityId, field)) ?? source;
  }

  /**
   * Overwrite `fields` of `target` (a response object being built) with
   * their translations; fields without one keep their source value.
   */
  apply<T extends object>(
    entityType: TranslatableEntityType,
    entityId: string,
    target: T,
    fields: readonly (keyof T & string)[],
  ): T {
    for (const f of fields) {
      const v = this.values.get(localizedKey(entityType, entityId, f));
      if (v != null) (target as Record<string, unknown>)[f] = v;
    }
    return target;
  }
}

/**
 * Resolves user-facing entity text in the caller's locale (docs/11 §3) for
 * read endpoints: one ContentTranslation query per call however many
 * entity types it covers, and a fallback note that becomes the
 * `X-Translation-Fallback` header. Also marks translations outdated when
 * an admin edits the source text.
 */
@Injectable()
export class ContentLocalizer {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The current request's content locale: `?locale=`, else the first
   * supported Accept-Language tag, else the signed-in user's stored
   * `User.locale`, else `pt-BR`. Memoized per request; `pt-BR` outside a
   * request (jobs).
   */
  requestLocale(): Promise<string> {
    const ctx = currentTranslationContext();
    if (!ctx) return Promise.resolve(DEFAULT_LOCALE);
    ctx.locale ??= this.resolveLocale(ctx.req);
    return ctx.locale;
  }

  private async resolveLocale(req: {
    query?: unknown;
    headers?: Record<string, unknown>;
    user?: { userId: string };
  }): Promise<string> {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const header = req.headers?.['accept-language'];
    const explicit = explicitRequestLocale(
      query['locale'],
      typeof header === 'string' ? header : undefined,
    );
    if (explicit) return explicit;
    if (req.user?.userId) {
      const u = await this.prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { locale: true },
      });
      if (isSupportedLocale(u?.locale)) return u.locale;
    }
    return DEFAULT_LOCALE;
  }

  /**
   * Translations for every entity in `groups`, in `locale` (default: the
   * request's). Notes a fallback on the request when any source text has
   * no translation in that locale.
   */
  async localize(
    groups: readonly LocalizeGroup[],
    locale?: string,
  ): Promise<Localized> {
    const loc = locale ?? (await this.requestLocale());
    const wanted = groups
      .map((g) => ({
        entityType: g.entityType,
        ids: [
          ...new Set(
            g.items
              .filter((i) => (i.sourceLocale ?? DEFAULT_LOCALE) !== loc)
              .map((i) => i.id),
          ),
        ],
      }))
      .filter((g) => g.ids.length > 0);
    if (wanted.length === 0) return new Localized(loc, new Map(), null);
    const rows = await this.prisma.contentTranslation.findMany({
      where: {
        locale: loc,
        OR: wanted.map((g) => ({
          entityType: g.entityType,
          entityId: { in: g.ids },
          field: { in: [...TRANSLATABLE_FIELDS[g.entityType]] },
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
    const { values, fallbackFrom } = localizeValues(groups, rows, loc);
    if (fallbackFrom) noteTranslationFallback(fallbackFrom);
    return new Localized(loc, values, fallbackFrom);
  }

  /**
   * Every locale's translation of one field, as `${entityId}|${locale}` →
   * value — for text built per recipient (push copy) outside a request.
   */
  async byLocale(
    entityType: TranslatableEntityType,
    entityIds: readonly string[],
    field: string,
  ): Promise<Map<string, string>> {
    if (entityIds.length === 0) return new Map();
    const rows = await this.prisma.contentTranslation.findMany({
      where: { entityType, entityId: { in: [...entityIds] }, field },
      select: { entityId: true, locale: true, value: true },
    });
    return new Map(
      rows
        .filter((r) => r.value)
        .map((r) => [`${r.entityId}|${r.locale}`, r.value]),
    );
  }

  /**
   * The source text of `fields` changed: flag every existing translation of
   * them as outdated (column-sourced entities have no source-locale rows,
   * so every row is a translation). Pass only fields whose value changed.
   */
  async markSourceChanged(
    entityType: TranslatableEntityType,
    entityId: string,
    fields: readonly string[],
  ): Promise<void> {
    const translatable = fields.filter((f) =>
      TRANSLATABLE_FIELDS[entityType].includes(f),
    );
    if (translatable.length === 0) return;
    await this.prisma.contentTranslation.updateMany({
      where: {
        entityType,
        entityId,
        field: { in: translatable },
        locale: { not: DEFAULT_LOCALE },
        outdated: false,
      },
      data: { outdated: true },
    });
  }
}

/**
 * Fields of `patch` whose value differs from `before` (for
 * {@link ContentLocalizer.markSourceChanged}). `undefined` = not patched.
 */
export function changedFields(
  before: object,
  patch: object,
  fields: readonly string[],
): string[] {
  const b = before as Record<string, unknown>;
  const p = patch as Record<string, unknown>;
  return fields.filter(
    (f) => p[f] !== undefined && (p[f] ?? null) !== (b[f] ?? null),
  );
}
