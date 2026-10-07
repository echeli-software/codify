import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type ContentLocale = 'pt-BR' | 'en-US';
export type TranslatableEntityType =
  | 'COURSE'
  | 'MODULE'
  | 'LESSON'
  | 'CATEGORY';
export type TranslationStatus = 'missing' | 'outdated' | 'done';

/** One source/target pair in the admin translation workspace. */
export interface TranslationRow {
  entityType: TranslatableEntityType;
  entityId: string;
  /** Source title/name, for display. */
  label: string;
  /** title | description | name | contentJson (JSON-encoded Tiptap doc). */
  field: string;
  sourceLocale: string;
  sourceValue: string;
  locale: string;
  value: string | null;
  outdated: boolean;
  status: TranslationStatus;
  updatedAt: string | null;
}

export interface ListTranslationsQuery {
  entityType?: TranslatableEntityType;
  locale?: ContentLocale;
  status?: TranslationStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface TranslationUpsert {
  entityType: TranslatableEntityType;
  entityId: string;
  field: string;
  locale: ContentLocale;
  value: string;
}

export interface CompletenessCounts {
  total: number;
  /** Up-to-date translations. */
  translated: number;
  outdated: number;
  /** translated / total × 100 (100 when there's nothing to translate). */
  pct: number;
}

export interface TranslationCompleteness {
  /** locale → entityType (and ALL) → counts. */
  locales: Record<
    string,
    Record<TranslatableEntityType | 'ALL', CompletenessCounts>
  >;
  entities: (CompletenessCounts & {
    entityType: TranslatableEntityType;
    entityId: string;
    label: string;
    locale: string;
  })[];
}

export interface ResolvedField {
  value: string | null;
  locale: string | null;
  /** True when served from the source/default locale instead of the requested one. */
  fallback: boolean;
}

export interface ResolvedTranslations {
  entityType: TranslatableEntityType;
  locale: string;
  /** entityId → field → resolved value. */
  items: Record<string, Record<string, ResolvedField>>;
}

/** Typed client for content translations (docs/11 §3). */
@Injectable({ providedIn: 'root' })
export class TranslationsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  /** ADMIN/TEACHER (own courses). */
  list(
    query: ListTranslationsQuery = {},
  ): Promise<{ items: TranslationRow[]; total: number }> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '')
        params = params.set(k, String(v));
    }
    return firstValueFrom(
      this.http.get<{ items: TranslationRow[]; total: number }>(
        `${this.base}/admin/translations`,
        { params },
      ),
    );
  }

  /** ADMIN/TEACHER: upsert one or many (clears outdated). All-or-nothing. */
  upsert(items: TranslationUpsert[]): Promise<{ updated: number }> {
    return firstValueFrom(
      this.http.put<{ updated: number }>(
        `${this.base}/admin/translations`,
        { items },
        { context: withIdempotency() },
      ),
    );
  }

  /** ADMIN/SUPPORT/TEACHER (own). */
  completeness(): Promise<TranslationCompleteness> {
    return firstValueFrom(
      this.http.get<TranslationCompleteness>(
        `${this.base}/admin/translations/completeness`,
      ),
    );
  }

  /** Public, cacheable batch resolve with source-locale fallback (≤ 100 ids). */
  resolve(
    entityType: TranslatableEntityType,
    ids: string[],
    locale: ContentLocale,
    fields?: string[],
  ): Promise<ResolvedTranslations> {
    let params = new HttpParams()
      .set('entityType', entityType)
      .set('ids', ids.join(','))
      .set('locale', locale);
    if (fields?.length) params = params.set('fields', fields.join(','));
    return firstValueFrom(
      this.http.get<ResolvedTranslations>(`${this.base}/translations`, {
        params,
      }),
    );
  }
}
