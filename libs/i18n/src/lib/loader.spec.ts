import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { I18nService } from './i18n.service.js';
import {
  CodifyTranslateLoader,
  loadTranslationBundle,
  preloadTranslations,
  type TranslationNamespace,
} from './loader.js';
import { ADMIN_STRINGS } from './namespaces/admin.js';
import { SHARED_NAMESPACES } from './namespaces/shared.js';
import { STUDENT_STRINGS } from './namespaces/student.js';
import { allNamespaces } from '../testing.js';
import { provideI18n } from './provider.js';
import { staticTranslationBundles } from './static-bundles.js';

/** Lazy path: test-setup preloads every bundle, so clear it here. */
describe('CodifyTranslateLoader (lazy namespaces)', () => {
  beforeEach(() => {
    preloadTranslations(null);
    localStorage.clear();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    preloadTranslations(staticTranslationBundles());
  });

  it('merges only the listed namespaces for the requested locale', async () => {
    const bundle = await loadTranslationBundle('en-US', [
      ...SHARED_NAMESPACES,
      STUDENT_STRINGS,
    ]);
    expect(Object.keys(bundle).sort()).toEqual(
      ['billing', 'common', 'gamification', 'student', 'time', 'ui'].sort(),
    );
    expect(bundle).not.toHaveProperty('admin');
    const pt = await loadTranslationBundle('pt-BR', [ADMIN_STRINGS]);
    expect(Object.keys(pt)).toEqual(['admin']);
    expect(pt).toEqual({ admin: staticTranslationBundles()['pt-BR']['admin'] });
  });

  it('every namespace loads in both locales', async () => {
    for (const locale of ['pt-BR', 'en-US'] as const) {
      const all = await loadTranslationBundle(locale, allNamespaces());
      expect(all).toEqual(staticTranslationBundles()[locale]);
    }
  });

  it('fetches only the configured namespaces through DI', async () => {
    const load = jest.fn((l: string) => Promise.resolve({ fake: { l } }));
    const fake: TranslationNamespace = { name: 'fake', load };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18n({ namespaces: [fake] }),
      ],
    });
    const loader = TestBed.runInInjectionContext(
      () => new CodifyTranslateLoader(),
    );
    await expect(
      firstValueFrom(loader.getTranslation('en-US')),
    ).resolves.toEqual({ fake: { l: 'en-US' } });
    // Unknown locales fall back to the default one.
    await firstValueFrom(loader.getTranslation('xx'));
    expect(load).toHaveBeenLastCalledWith('pt-BR');
  });

  it('init waits for the strings, then t() is synchronous', async () => {
    localStorage.setItem('codify.locale', 'pt-BR');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18n({ namespaces: SHARED_NAMESPACES }),
      ],
    });
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    expect(i18n.currentLocale()).toBe('pt-BR');
    expect(i18n.t('common.save')).toBe('Salvar');
    // Switching applies only once the other locale is loaded.
    const switching = i18n.setLocale('en-US');
    expect(i18n.currentLocale()).toBe('pt-BR');
    await switching;
    expect(i18n.currentLocale()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(i18n.t('common.save')).toBe('Save');
  });

  it('the last of two quick switches wins', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18n({ namespaces: SHARED_NAMESPACES }),
      ],
    });
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    const a = i18n.setLocale('en-US');
    const b = i18n.setLocale('pt-BR');
    await Promise.all([a, b]);
    expect(i18n.currentLocale()).toBe('pt-BR');
  });

  it('a failed load keeps the current locale and never rejects', async () => {
    const err = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const broken: TranslationNamespace = {
      name: 'broken',
      load: (l) =>
        l === 'en-US'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({}),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18n({ namespaces: [broken] }),
      ],
    });
    const i18n = TestBed.inject(I18nService);
    localStorage.setItem('codify.locale', 'pt-BR');
    await i18n.init();
    await expect(i18n.setLocale('en-US')).resolves.toBeUndefined();
    expect(i18n.currentLocale()).toBe('pt-BR');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
