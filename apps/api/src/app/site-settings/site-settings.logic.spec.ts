import {
  coerceSettings,
  effectiveLocale,
  validateBranding,
  validateEnabledLocales,
} from './site-settings.logic.js';

describe('site settings validation', () => {
  it('accepts known tokens with hex colours and a short label', () => {
    expect(
      validateBranding({
        tokens: { primary: '#ff0066', accent: '#abc' },
        label: 'STAGING',
      }),
    ).toEqual([]);
  });

  it('rejects unknown tokens, non-hex values and long labels', () => {
    const p = validateBranding({
      tokens: { primary: 'red', 'text-muted': '#000' },
      label: 'x'.repeat(30),
      extra: 1,
    });
    expect(p).toEqual(
      expect.arrayContaining([
        'branding.extra: unknown field',
        'branding.tokens.text-muted: unknown token',
        'branding.tokens.primary must be a hex colour (#rgb / #rrggbb)',
        'branding.label must be a string of at most 24 characters',
      ]),
    );
  });

  it('requires the default locale and only supported locales', () => {
    expect(validateEnabledLocales(['pt-BR'])).toEqual([]);
    expect(validateEnabledLocales(['en-US'])).toEqual([
      'enabledLocales must include the default locale pt-BR',
    ]);
    expect(validateEnabledLocales(['pt-BR', 'fr-FR'])).toEqual([
      'enabledLocales: fr-FR is not a supported locale',
    ]);
  });
});

describe('coerceSettings / effectiveLocale', () => {
  it('falls back to defaults for missing or invalid rows', () => {
    const d = coerceSettings({});
    expect(d.locales.enabled).toEqual(['pt-BR', 'en-US']);
    expect(d.branding).toEqual({ tokens: {}, label: null });
    expect(
      coerceSettings({ branding: { tokens: { primary: 'nope' } } }).branding,
    ).toEqual({
      tokens: {},
      label: null,
    });
    const s = coerceSettings({ locales: ['pt-BR'] });
    expect(s.locales.enabled).toEqual(['pt-BR']);
    expect(effectiveLocale('en-US', s)).toBe('pt-BR');
    expect(effectiveLocale('pt-BR', s)).toBe('pt-BR');
  });
});
