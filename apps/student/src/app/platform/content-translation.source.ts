import { Injectable, inject } from '@angular/core';
import {
  TranslationsClient,
  type ContentLocale,
  type TranslatableEntityType,
} from '@codify/api-client';
import type {
  ContentTranslationBatch,
  ContentTranslationRequest,
  ContentTranslationSource,
} from '@codify/i18n';
import { DownloadService } from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';

const ENTITY_TYPES = new Set(['COURSE', 'MODULE', 'LESSON', 'CATEGORY']);

/**
 * `CONTENT_TRANSLATION_SOURCE` for the student app: `GET /translations`
 * online, the downloaded ContentTranslation rows offline (or when the
 * request fails). Only real translations are returned — source-locale
 * fallbacks are left to the caller's own fallback value.
 */
@Injectable({ providedIn: 'root' })
export class StudentContentTranslationSource implements ContentTranslationSource {
  private readonly client = inject(TranslationsClient);
  private readonly downloads = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);

  async fetch(
    req: ContentTranslationRequest,
  ): Promise<ContentTranslationBatch> {
    if (!ENTITY_TYPES.has(req.entityType)) return {};
    if (this.network.online()) {
      try {
        const res = await this.client.resolve(
          req.entityType as TranslatableEntityType,
          [...req.ids],
          req.locale as ContentLocale,
        );
        const out: ContentTranslationBatch = {};
        for (const [id, fields] of Object.entries(res.items ?? {})) {
          const values: Record<string, string> = {};
          for (const [field, v] of Object.entries(fields ?? {})) {
            if (v && !v.fallback && typeof v.value === 'string')
              values[field] = v.value;
          }
          out[id] = values;
        }
        return out;
      } catch {
        /* fall through to the offline copy */
      }
    }
    return this.downloads.getTranslations(req.entityType, req.ids, req.locale);
  }
}
