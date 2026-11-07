/**
 * Template + signal entry points for content translation (docs/11 §3).
 * See ./content-translation.ts for the batching/caching service.
 */

import {
  Pipe,
  computed,
  inject,
  isSignal,
  type PipeTransform,
  type Signal,
} from '@angular/core';
import { I18nService } from './i18n.service.js';
import {
  ContentTranslationService,
  type ContentEntityType,
} from './content-translation.js';

type MaybeSignal<T> = T | Signal<T> | (() => T);

function read<T>(v: MaybeSignal<T>): T {
  if (isSignal(v)) return v();
  if (typeof v === 'function') return (v as () => T)();
  return v;
}

/**
 * Signal helper for components/services (must run in an injection
 * context). Tracks the current locale, so it updates on language switch.
 */
export function tContent(
  entityType: ContentEntityType,
  entityId: MaybeSignal<string | null | undefined>,
  field: string,
  opts: { fallback?: MaybeSignal<string | null | undefined> } = {},
): Signal<string> {
  const content = inject(ContentTranslationService);
  const i18n = inject(I18nService);
  return computed(() => {
    const fallback = opts.fallback === undefined ? null : read(opts.fallback);
    return (
      content.translate(
        entityType,
        read(entityId),
        field,
        i18n.currentLocale(),
        fallback ?? null,
      ) ?? ''
    );
  });
}

/**
 * `{{ courseId | tContent: 'COURSE' : 'title' : course.title }}` — the
 * last argument is the source-locale value shown while loading or when no
 * translation exists.
 */
@Pipe({ name: 'tContent', pure: false })
export class ContentTranslatePipe implements PipeTransform {
  private readonly content = inject(ContentTranslationService);
  private readonly i18n = inject(I18nService);

  transform(
    entityId: string | null | undefined,
    entityType: ContentEntityType,
    field: string,
    fallback?: string | null,
  ): string {
    return (
      this.content.translate(
        entityType,
        entityId,
        field,
        this.i18n.currentLocale(),
        fallback ?? null,
      ) ?? ''
    );
  }
}
