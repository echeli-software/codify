import { Injectable, inject } from '@angular/core';
import { AuthService } from '@codify/auth';
import {
  MeClient,
  TranslationsClient,
  type ContentLocale,
  type TranslatableEntityType,
} from '@codify/api-client';
import type {
  ContentTranslationBatch,
  ContentTranslationRequest,
  ContentTranslationSource,
  Locale,
  LocalePersistence,
} from '@codify/i18n';

/** `LOCALE_PERSISTENCE`: save the staff member's UI language on `User.locale`. */
@Injectable({ providedIn: 'root' })
export class MeLocalePersistence implements LocalePersistence {
  private readonly me = inject(MeClient);
  private readonly auth = inject(AuthService);

  async persist(locale: Locale): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    this.auth.updateProfile({ locale });
    await this.me.update({ locale });
  }
}

const ENTITY_TYPES: readonly TranslatableEntityType[] = [
  'COURSE',
  'MODULE',
  'LESSON',
  'CATEGORY',
];

/**
 * `CONTENT_TRANSLATION_SOURCE`: batch-resolves course/module/lesson/category
 * strings through `GET /api/translations` (source-locale fallback included).
 */
@Injectable({ providedIn: 'root' })
export class ApiContentTranslationSource implements ContentTranslationSource {
  private readonly translations = inject(TranslationsClient);

  async fetch(
    req: ContentTranslationRequest,
  ): Promise<ContentTranslationBatch> {
    const type = req.entityType as TranslatableEntityType;
    if (!ENTITY_TYPES.includes(type) || req.ids.length === 0) return {};
    const res = await this.translations.resolve(
      type,
      [...req.ids],
      req.locale as ContentLocale,
    );
    const out: ContentTranslationBatch = {};
    for (const [id, fields] of Object.entries(res.items)) {
      const values: Record<string, string> = {};
      for (const [field, resolved] of Object.entries(fields)) {
        if (resolved.value !== null) values[field] = resolved.value;
      }
      out[id] = values;
    }
    return out;
  }
}
