import { TestBed } from '@angular/core/testing';
import {
  MissingTranslationHandler,
  TranslateService,
} from '@ngx-translate/core';
import { provideI18n } from '@codify/i18n';
import {
  MAX_REPORTS,
  ReportingMissingTranslationHandler,
  noteMissingTranslation,
  resetMissingTranslations,
  setMissingTranslationReporter,
} from './missing-translation';

describe('missing translation reporting (docs/11 §2)', () => {
  afterEach(() => resetMissingTranslations());

  it('production: reports each key once per session, capped', () => {
    const reports: string[] = [];
    setMissingTranslationReporter((key, locale) =>
      reports.push(`${locale}:${key}`),
    );
    noteMissingTranslation('a.b', 'pt-BR', false);
    noteMissingTranslation('a.b', 'pt-BR', false);
    noteMissingTranslation('a.b', 'en-US', false);
    expect(reports).toEqual(['pt-BR:a.b', 'en-US:a.b']);
    for (let i = 0; i < 50; i++)
      noteMissingTranslation(`k${i}`, 'pt-BR', false);
    expect(reports).toHaveLength(MAX_REPORTS);
  });

  it('dev: logs once to the console and sends nothing', () => {
    const reporter = jest.fn();
    setMissingTranslationReporter(reporter);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    noteMissingTranslation('x.y', 'pt-BR', true);
    noteMissingTranslation('x.y', 'pt-BR', true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reporter).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a throwing reporter never breaks rendering', () => {
    setMissingTranslationReporter(() => {
      throw new Error('sentry down');
    });
    expect(() => noteMissingTranslation('z', 'pt-BR', false)).not.toThrow();
  });

  it('overrides the ngx-translate handler next to provideI18n and still renders the key', async () => {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18n(),
        {
          provide: MissingTranslationHandler,
          useClass: ReportingMissingTranslationHandler,
        },
      ],
    });
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const translate = TestBed.inject(TranslateService);
    expect(translate.instant('definitely.not_a_key')).toBe(
      'definitely.not_a_key',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('definitely.not_a_key'),
    );
    warn.mockRestore();
  });
});
