import { DOCUMENT } from '@angular/common';
import { effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { I18nService } from '@codify/i18n';

/**
 * Per-page `<title>` + description / Open Graph meta for the public pages.
 * Must run in an injection context (a component constructor); re-applies
 * whenever the user switches language.
 *
 *   usePageMeta('student.pricing.metaTitle', 'student.pricing.metaDescription');
 */
export function usePageMeta(titleKey: string, descriptionKey: string): void {
  const title = inject(Title);
  const meta = inject(Meta);
  const i18n = inject(I18nService);
  const doc = inject(DOCUMENT);
  effect(() => {
    const locale = i18n.currentLocale();
    const t = i18n.t(titleKey);
    const d = i18n.t(descriptionKey);
    title.setTitle(t);
    meta.updateTag({ name: 'description', content: d });
    meta.updateTag({ property: 'og:title', content: t });
    meta.updateTag({ property: 'og:description', content: d });
    meta.updateTag({ property: 'og:type', content: 'website' });
    meta.updateTag({
      property: 'og:locale',
      content: locale.replace('-', '_'),
    });
    const url = doc.location?.href;
    if (url) meta.updateTag({ property: 'og:url', content: url });
    meta.updateTag({ name: 'twitter:card', content: 'summary' });
  });
}
