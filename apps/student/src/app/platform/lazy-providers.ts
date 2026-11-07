import { Injector, inject, type Provider } from '@angular/core';
import {
  CONTENT_TRANSLATION_SOURCE,
  type ContentTranslationRequest,
  type ContentTranslationSource,
} from '@codify/i18n';

/**
 * `CONTENT_TRANSLATION_SOURCE` that loads the real (download-aware) source
 * on first use, so the offline/download services stay out of the initial
 * bundle.
 */
export function provideLazyContentTranslationSource(): Provider {
  return {
    provide: CONTENT_TRANSLATION_SOURCE,
    useFactory: (): ContentTranslationSource => {
      const injector = inject(Injector);
      return {
        async fetch(req: ContentTranslationRequest) {
          const m = await import('./content-translation.source');
          return injector.get(m.StudentContentTranslationSource).fetch(req);
        },
      };
    },
  };
}
