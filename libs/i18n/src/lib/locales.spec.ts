import {
  isLocale,
  pickLocale,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from './locales.js';

describe('isLocale', () => {
  it('accepts supported codes', () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(isLocale(code)).toBe(true);
    }
  });
  it('rejects unsupported codes', () => {
    expect(isLocale('fr-FR')).toBe(false);
    expect(isLocale('zh')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('pickLocale', () => {
  it('picks an exact match first', () => {
    expect(pickLocale(['en-US'])).toBe('en-US');
    expect(pickLocale(['pt-BR'])).toBe('pt-BR');
  });
  it('falls back to language match', () => {
    expect(pickLocale(['pt-PT'])).toBe('pt-BR');
    expect(pickLocale(['en-GB'])).toBe('en-US');
  });
  it('falls back to default if no candidate matches', () => {
    expect(pickLocale(['fr-FR', 'de-DE'])).toBe(DEFAULT_LOCALE);
    expect(pickLocale([])).toBe(DEFAULT_LOCALE);
  });
  it('respects ordering', () => {
    expect(pickLocale(['fr-FR', 'en-US', 'pt-BR'])).toBe('en-US');
  });
});
