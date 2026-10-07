import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import {
  CONTENT_TRANSLATION_BATCH_SIZE,
  CONTENT_TRANSLATION_SOURCE,
  ContentTranslationService,
  type ContentTranslationBatch,
  type ContentTranslationRequest,
  type ContentTranslationSource,
} from './content-translation.js';
import { ContentTranslatePipe, tContent } from './content-translate.pipe.js';
import { I18nService } from './i18n.service.js';
import {
  LocalePipe,
  currencyForLocale,
  defaultDateFormat,
  formatForLocale,
} from './locale.pipe.js';
import { LOCALE_PERSISTENCE } from './persistence.js';
import { provideI18n } from './provider.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const nbsp = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

class FakeSource implements ContentTranslationSource {
  calls: ContentTranslationRequest[] = [];
  data: Record<string, ContentTranslationBatch> = {
    'en-US': { c1: { title: 'React Fundamentals' }, c2: { title: 'Node 101' } },
    'pt-BR': { c1: { title: 'Fundamentos de React' } },
  };
  fail = false;
  fetch(req: ContentTranslationRequest): Promise<ContentTranslationBatch> {
    this.calls.push(req);
    if (this.fail) return Promise.reject(new Error('boom'));
    const all = this.data[req.locale] ?? {};
    return Promise.resolve(
      Object.fromEntries(req.ids.map((id) => [id, all[id]])),
    );
  }
}

function setup(extra: unknown[] = []) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideI18n(),
      ...(extra as never[]),
    ],
  });
  return TestBed.inject(I18nService);
}

describe('I18nService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sets <html lang/dir> and persists locally on setLocale', () => {
    const i18n = setup();
    i18n.setLocale('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(document.documentElement.dir).toBe('ltr');
    expect(localStorage.getItem('codify.locale')).toBe('en-US');
  });

  it('interpolates ICU strings through ngx-translate (compiler wired)', () => {
    const i18n = setup();
    i18n.setLocale('en-US');
    expect(i18n.t('gamification.xp.earned', { value: 1200 })).toBe('+1,200 XP');
    expect(i18n.t('time.unit.day', { value: 1 })).toBe('1 day');
    expect(i18n.t('time.unit.day', { value: 3 })).toBe('3 days');
    i18n.setLocale('pt-BR');
    expect(i18n.t('gamification.xp.earned', { value: 1200 })).toBe('+1.200 XP');
  });

  it('changeLocale calls LOCALE_PERSISTENCE and swallows failures', async () => {
    const persist = jest.fn().mockRejectedValueOnce(new Error('offline'));
    const i18n = setup([
      { provide: LOCALE_PERSISTENCE, useValue: { persist } },
    ]);
    await i18n.changeLocale('en-US');
    expect(persist).toHaveBeenCalledWith('en-US');
    expect(i18n.currentLocale()).toBe('en-US');
    await i18n.changeLocale('xx-XX' as never);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('changeLocale works without persistence', async () => {
    const i18n = setup();
    await i18n.changeLocale('en-US');
    expect(i18n.currentLocale()).toBe('en-US');
  });

  it('provideI18n accepts contentSource / persistence classes', () => {
    class P {
      persist = jest.fn();
    }
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18n({ contentSource: FakeSource, persistence: P }),
      ],
    });
    expect(TestBed.inject(CONTENT_TRANSLATION_SOURCE)).toBeInstanceOf(
      FakeSource,
    );
    expect(TestBed.inject(LOCALE_PERSISTENCE)).toBeInstanceOf(P);
  });
});

describe('formatForLocale / LocalePipe', () => {
  afterEach(() => TestBed.resetTestingModule());
  const date = new Date('2026-10-07T15:30:00Z');

  it('formats numbers, percent, compact and integers', () => {
    expect(formatForLocale(1234.5, 'pt-BR')).toBe('1.234,5');
    expect(formatForLocale(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatForLocale('1234.567', 'en-US', 'integer')).toBe('1,235');
    expect(formatForLocale(0.425, 'en-US', 'percent')).toBe('42.5%');
    expect(formatForLocale(12345, 'en-US', 'compact')).toBe('12.3K');
    expect(formatForLocale('abc', 'en-US')).toBe('');
    expect(formatForLocale(null, 'en-US')).toBe('');
  });

  it('formats cents as currency, defaulting by locale', () => {
    expect(nbsp(formatForLocale(3990, 'pt-BR', 'currency'))).toBe('R$ 39,90');
    expect(formatForLocale(999, 'en-US', 'currency')).toBe('$9.99');
    expect(nbsp(formatForLocale(999, 'en-US', 'currency', 'BRL'))).toBe(
      'R$9.99',
    );
    expect(formatForLocale('x', 'en-US', 'currency')).toBe('');
  });

  it('formats dates, times and relative dates', () => {
    expect(formatForLocale(date, 'en-US', 'date')).toBe('Oct 7, 2026');
    expect(formatForLocale(date.toISOString(), 'pt-BR', 'date', 'long')).toBe(
      '7 de outubro de 2026',
    );
    expect(formatForLocale(date, 'en-US', 'time')).toMatch(/\d{1,2}:30/);
    expect(formatForLocale(date, 'en-US', 'datetime')).toMatch(/Oct 7, 2026/);
    expect(
      formatForLocale(
        date.getTime() - 5 * 60_000,
        'en-US',
        'relative',
        undefined,
        date.getTime(),
      ),
    ).toBe('5 minutes ago');
    expect(formatForLocale('not a date', 'en-US', 'date')).toBe('');
    expect(formatForLocale(1, 'en-US', 'bogus' as never)).toBe('1');
  });

  it('currencyForLocale / defaultDateFormat', () => {
    expect(currencyForLocale('pt-BR')).toBe('BRL');
    expect(currencyForLocale('en-US')).toBe('USD');
    expect(currencyForLocale('pt-PT')).toBe('BRL');
    expect(currencyForLocale('de-DE')).toBe('USD');
    expect(defaultDateFormat('en-US').month).toBe('short');
    expect(defaultDateFormat('pt-BR').day).toBe('numeric');
  });

  it('re-renders when the locale switches', async () => {
    @Component({
      imports: [LocalePipe, TranslatePipe],
      template: `{{ 3990 | locale: 'currency' }}|{{
          'common.save' | translate
        }}`,
    })
    class Host {}
    const i18n = setup();
    i18n.setLocale('pt-BR');
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(nbsp(fixture.nativeElement.textContent)).toBe('R$ 39,90|Salvar');
    i18n.setLocale('en-US');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe('$39.90|Save');
  });
});

describe('content translation', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setupContent() {
    const source = new FakeSource();
    const i18n = setup([
      { provide: CONTENT_TRANSLATION_SOURCE, useValue: source },
    ]);
    i18n.setLocale('en-US');
    return {
      source,
      i18n,
      content: TestBed.inject(ContentTranslationService),
    };
  }

  it('batches lookups made in the same tick into one request', async () => {
    const { source, i18n, content } = setupContent();
    expect(i18n.tContent('COURSE', 'c1', 'title', { fallback: 'src' })).toBe(
      'src',
    );
    i18n.tContent('COURSE', 'c2', 'title');
    i18n.tContent('COURSE', 'c1', 'title');
    await flush();
    expect(source.calls).toEqual([
      { entityType: 'COURSE', ids: ['c1', 'c2'], locale: 'en-US' },
    ]);
    expect(i18n.tContent('COURSE', 'c1', 'title')).toBe('React Fundamentals');
    expect(content.enabled).toBe(true);
    expect(content.fields('COURSE', 'c2', 'en-US')()).toEqual({
      title: 'Node 101',
    });
  });

  it('caches per locale and refetches after a switch', async () => {
    const { source, i18n } = setupContent();
    i18n.tContent('COURSE', 'c1', 'title');
    await flush();
    i18n.tContent('COURSE', 'c1', 'title');
    await flush();
    expect(source.calls).toHaveLength(1);
    i18n.setLocale('pt-BR');
    i18n.tContent('COURSE', 'c1', 'title');
    await flush();
    expect(source.calls).toHaveLength(2);
    expect(i18n.tContent('COURSE', 'c1', 'title')).toBe('Fundamentos de React');
  });

  it('missing rows and failures fall back; invalidate retries', async () => {
    const { source, i18n, content } = setupContent();
    source.fail = true;
    await content.prefetch('COURSE', ['c1'], 'en-US');
    expect(i18n.tContent('COURSE', 'c1', 'title', { fallback: 'src' })).toBe(
      'src',
    );
    expect(i18n.tContent('COURSE', 'c9', 'title', { locale: 'en-US' })).toBe(
      '',
    );
    source.fail = false;
    content.invalidate('MODULE');
    content.invalidate('COURSE', 'c2');
    content.invalidate('COURSE', 'c1');
    await content.prefetch('COURSE', ['c1'], 'en-US');
    expect(i18n.tContent('COURSE', 'c1', 'title')).toBe('React Fundamentals');
    expect(i18n.tContent('COURSE', null, 'title', { fallback: 'x' })).toBe('x');
  });

  it('accepts observable sources and chunks large batches', async () => {
    const subjects: Subject<ContentTranslationBatch>[] = [];
    const fetch = jest.fn(() => {
      const s = new Subject<ContentTranslationBatch>();
      subjects.push(s);
      return s;
    });
    setup([{ provide: CONTENT_TRANSLATION_SOURCE, useValue: { fetch } }]);
    const content = TestBed.inject(ContentTranslationService);
    const ids = Array.from(
      { length: CONTENT_TRANSLATION_BATCH_SIZE + 1 },
      (_, i) => `l${i}`,
    );
    const done = content.prefetch('LESSON', ids, 'en-US');
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    subjects[0].next({ l0: { title: 'Zero' } });
    subjects[1].next({});
    await done;
    expect(content.translate('LESSON', 'l0', 'title', 'en-US')).toBe('Zero');
    expect(content.translate('LESSON', 'l100', 'title', 'en-US', 'fb')).toBe(
      'fb',
    );
  });

  it('without a source returns fallbacks and never fetches', () => {
    setup();
    const content = TestBed.inject(ContentTranslationService);
    expect(content.enabled).toBe(false);
    expect(content.translate('COURSE', 'c1', 'title', 'en-US', 'src')).toBe(
      'src',
    );
  });

  it('pipe and tContent() re-render once the batch lands', async () => {
    @Component({
      imports: [ContentTranslatePipe],
      template: `{{ 'c1' | tContent: 'COURSE' : 'title' : 'Fonte' }}|{{
          sig()
        }}`,
    })
    class Host {
      readonly sig = tContent('COURSE', () => 'c2', 'title', {
        fallback: 'Fallback',
      });
    }
    const { i18n } = setupContent();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe('Fonte|Fallback');
    await flush();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe(
      'React Fundamentals|Node 101',
    );
    i18n.setLocale('pt-BR');
    await flush();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe(
      'Fundamentos de React|Fallback',
    );
    expect(TestBed.inject(TranslateService).getCurrentLang()).toBe('pt-BR');
  });
});
