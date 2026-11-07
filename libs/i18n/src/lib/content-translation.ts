/**
 * Content translation (docs/11 §3) — per-entity strings stored in the
 * `ContentTranslation` table, as opposed to chrome strings in JSON.
 *
 * The lib does not talk HTTP itself: apps provide a
 * `CONTENT_TRANSLATION_SOURCE` (backed by `GET /api/translations`) and the
 * service batches lookups made in the same tick into one request per
 * (entityType, locale), caches results per locale, and exposes them as
 * signals so templates re-render when a batch lands or the locale changes.
 *
 *   providers: [{ provide: CONTENT_TRANSLATION_SOURCE, useClass: ApiTranslationSource }]
 *
 *   {{ course.id | tContent: 'COURSE' : 'title' : course.title }}
 *   readonly title = tContent('COURSE', () => this.course().id, 'title', {
 *     fallback: () => this.course().title,
 *   });
 */

import {
  Injectable,
  InjectionToken,
  inject,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { firstValueFrom, isObservable, type Observable } from 'rxjs';

/** Mirrors Prisma `TranslatableEntity`; open-ended for future entity types. */
export type ContentEntityType =
  | 'COURSE'
  | 'MODULE'
  | 'LESSON'
  | 'CATEGORY'
  | (string & {});

export interface ContentTranslationRequest {
  entityType: ContentEntityType;
  ids: readonly string[];
  locale: string;
}

/** `entityId → field → translated value`. Ids without a row may be omitted. */
export type ContentTranslationBatch = Record<
  string,
  Record<string, string> | undefined
>;

export interface ContentTranslationSource {
  fetch(
    req: ContentTranslationRequest,
  ): Observable<ContentTranslationBatch> | Promise<ContentTranslationBatch>;
}

export const CONTENT_TRANSLATION_SOURCE =
  new InjectionToken<ContentTranslationSource>('CONTENT_TRANSLATION_SOURCE');

/** Max ids per request — keeps the query string well under URL limits. */
export const CONTENT_TRANSLATION_BATCH_SIZE = 100;

/** `undefined` = not fetched yet / in flight; `null` = no translation. */
type Entry = WritableSignal<Record<string, string> | null | undefined>;

export interface ContentLookupOptions {
  /** Value to show while loading or when no translation exists. */
  fallback?: string | null;
  /** Override the locale (defaults to the caller's current locale). */
  locale?: string;
}

@Injectable({ providedIn: 'root' })
export class ContentTranslationService {
  private readonly source = inject(CONTENT_TRANSLATION_SOURCE, {
    optional: true,
  });
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<
    string,
    { entityType: string; locale: string; ids: Set<string> }
  >();
  private flushQueued = false;

  /** True when an app provided a source; otherwise lookups return fallbacks. */
  get enabled(): boolean {
    return this.source !== null;
  }

  /**
   * Synchronous, signal-backed lookup. Reading it inside a template /
   * computed re-runs once the batch lands. Triggers a fetch on first use.
   */
  translate(
    entityType: ContentEntityType,
    entityId: string | null | undefined,
    field: string,
    locale: string,
    fallback: string | null = null,
  ): string | null {
    if (!entityId) return fallback;
    const entry = this.entry(entityType, entityId, locale);
    const fields = entry();
    return fields?.[field] ?? fallback;
  }

  /** Signal view of one entity's fields (undefined while loading). */
  fields(
    entityType: ContentEntityType,
    entityId: string,
    locale: string,
  ): Signal<Record<string, string> | null | undefined> {
    return this.entry(entityType, entityId, locale).asReadonly();
  }

  /** Warm the cache for a list (e.g. a catalog page) in one request. */
  async prefetch(
    entityType: ContentEntityType,
    ids: readonly string[],
    locale: string,
  ): Promise<void> {
    for (const id of ids) this.entry(entityType, id, locale);
    await this.flush();
  }

  /** Drop cached values (e.g. after an admin edits a translation). */
  invalidate(entityType?: ContentEntityType, entityId?: string): void {
    for (const key of [...this.entries.keys()]) {
      const [, type, id] = key.split('|');
      if (entityType && type !== entityType) continue;
      if (entityId && id !== entityId) continue;
      this.entries.delete(key);
    }
  }

  private entry(entityType: string, entityId: string, locale: string): Entry {
    const key = `${locale}|${entityType}|${entityId}`;
    let entry = this.entries.get(key);
    if (entry) return entry;
    if (!this.source) {
      entry = signal<Record<string, string> | null | undefined>(null);
      this.entries.set(key, entry);
      return entry;
    }
    entry = signal<Record<string, string> | null | undefined>(undefined);
    this.entries.set(key, entry);
    const groupKey = `${locale}|${entityType}`;
    let group = this.pending.get(groupKey);
    if (!group) {
      group = { entityType, locale, ids: new Set() };
      this.pending.set(groupKey, group);
    }
    group.ids.add(entityId);
    this.queueFlush();
    return entry;
  }

  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => void this.flush());
  }

  private async flush(): Promise<void> {
    this.flushQueued = false;
    const groups = [...this.pending.values()];
    this.pending.clear();
    const source = this.source;
    if (!source) return;
    const jobs: Promise<void>[] = [];
    for (const group of groups) {
      const ids = [...group.ids];
      for (let i = 0; i < ids.length; i += CONTENT_TRANSLATION_BATCH_SIZE) {
        const chunk = ids.slice(i, i + CONTENT_TRANSLATION_BATCH_SIZE);
        jobs.push(this.load(source, group.entityType, group.locale, chunk));
      }
    }
    await Promise.all(jobs);
  }

  private async load(
    source: ContentTranslationSource,
    entityType: string,
    locale: string,
    ids: string[],
  ): Promise<void> {
    let batch: ContentTranslationBatch = {};
    try {
      const res = source.fetch({ entityType, ids, locale });
      batch = (isObservable(res) ? await firstValueFrom(res) : await res) ?? {};
    } catch {
      // Network failure → fall back to source-locale values; a later
      // `invalidate()` (or locale switch) retries.
      batch = {};
    }
    for (const id of ids) {
      const entry = this.entries.get(`${locale}|${entityType}|${id}`);
      const fields = batch[id];
      entry?.set(fields && Object.keys(fields).length > 0 ? fields : null);
    }
  }
}
