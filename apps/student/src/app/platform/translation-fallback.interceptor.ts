import { Injectable, inject } from '@angular/core';
import { HttpResponse, type HttpInterceptorFn } from '@angular/common/http';
import { tap } from 'rxjs';
import { TRANSLATION_FALLBACK_HEADER } from '@codify/api-client';
import { I18nService } from '@codify/i18n';
import { AppToastService } from './app-toast.service';

/** sessionStorage key prefix: one flag per UI locale. */
export const FALLBACK_NOTICE_STORAGE_PREFIX = 'cdf.translationFallbackNoticed.';

/**
 * docs/11 §3: when content arrives in another locale than the UI's
 * (`X-Translation-Fallback`), tell the user once — per UI locale per
 * browser session (persisted in sessionStorage per locale, so reloads and
 * other tabs of the session don't repeat it).
 */
@Injectable({ providedIn: 'root' })
export class TranslationFallbackNotice {
  private readonly toast = inject(AppToastService);
  private readonly i18n = inject(I18nService);
  /** In-memory guard for when storage is unavailable. */
  private readonly noticed = new Set<string>();

  /** Handle one response's header value (null = no fallback). */
  onHeader(value: string | null): void {
    const from = value?.split(',')[0]?.trim();
    if (!from) return;
    const locale = this.i18n.currentLocale();
    if (from === locale || this.wasNoticed(locale)) return;
    this.markNoticed(locale);
    this.toast.show({
      message: 'student.translationFallback.toast',
      params: { locale },
      kind: 'info',
    });
  }

  private wasNoticed(locale: string): boolean {
    if (this.noticed.has(locale)) return true;
    try {
      return (
        sessionStorage.getItem(FALLBACK_NOTICE_STORAGE_PREFIX + locale) === '1'
      );
    } catch {
      return false;
    }
  }

  private markNoticed(locale: string): void {
    this.noticed.add(locale);
    try {
      sessionStorage.setItem(FALLBACK_NOTICE_STORAGE_PREFIX + locale, '1');
    } catch {
      /* private mode / storage disabled: the in-memory guard covers it */
    }
  }
}

/** Watches API responses for `X-Translation-Fallback`. */
export const translationFallbackInterceptor: HttpInterceptorFn = (
  req,
  next,
) => {
  const notice = inject(TranslationFallbackNotice);
  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse)
        notice.onHeader(event.headers.get(TRANSLATION_FALLBACK_HEADER));
    }),
  );
};
