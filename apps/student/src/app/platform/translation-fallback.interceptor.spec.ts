import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '@codify/i18n';
import { AppToastService } from './app-toast.service';
import {
  FALLBACK_NOTICE_STORAGE_PREFIX,
  translationFallbackInterceptor,
} from './translation-fallback.interceptor';

describe('translationFallbackInterceptor', () => {
  const locale = signal<'pt-BR' | 'en-US'>('en-US');

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([translationFallbackInterceptor])),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: { currentLocale: locale } },
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      ctrl: TestBed.inject(HttpTestingController),
      toast: TestBed.inject(AppToastService),
    };
  }

  async function get(
    s: ReturnType<typeof setup>,
    headers: Record<string, string> = {},
  ) {
    const p = firstValueFrom(s.http.get('/api/lessons/l1'));
    s.ctrl.expectOne('/api/lessons/l1').flush({ ok: true }, { headers });
    return p;
  }

  beforeEach(() => {
    sessionStorage.clear();
    locale.set('en-US');
  });

  it('shows one info toast per locale per session', async () => {
    const s = setup();
    await get(s, { 'X-Translation-Fallback': 'pt-BR' });
    expect(s.toast.toasts()).toEqual([
      expect.objectContaining({
        message: 'student.translationFallback.toast',
        params: { locale: 'en-US' },
        kind: 'info',
      }),
    ]);
    expect(
      sessionStorage.getItem(`${FALLBACK_NOTICE_STORAGE_PREFIX}en-US`),
    ).toBe('1');

    s.toast.clear();
    await get(s, { 'X-Translation-Fallback': 'pt-BR' });
    expect(s.toast.toasts()).toHaveLength(0);

    // Another UI locale gets its own notice.
    locale.set('pt-BR');
    await get(s, { 'X-Translation-Fallback': 'en-US' });
    expect(s.toast.toasts()).toHaveLength(1);
  });

  it('remembers the notice across a reload (sessionStorage)', async () => {
    sessionStorage.setItem(`${FALLBACK_NOTICE_STORAGE_PREFIX}en-US`, '1');
    const s = setup();
    await get(s, { 'X-Translation-Fallback': 'pt-BR' });
    expect(s.toast.toasts()).toHaveLength(0);
  });

  it('ignores responses without the header or already in the UI locale', async () => {
    const s = setup();
    await get(s);
    await get(s, { 'X-Translation-Fallback': 'en-US' });
    expect(s.toast.toasts()).toHaveLength(0);
  });

  it('still notices once when storage is unavailable', async () => {
    const spy = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    const set = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    const s = setup();
    await get(s, { 'X-Translation-Fallback': 'pt-BR' });
    await get(s, { 'X-Translation-Fallback': 'pt-BR' });
    expect(s.toast.toasts()).toHaveLength(1);
    spy.mockRestore();
    set.mockRestore();
  });
});
