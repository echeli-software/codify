import { compileIcu, formatIcu, needsIcu } from './icu.js';
import { TRANSLATION_BUNDLES } from './loader.js';

describe('formatIcu', () => {
  it('substitutes single-brace params', () => {
    expect(formatIcu('+{value} XP', { value: 240 }, 'en-US')).toBe('+240 XP');
  });
  it('formats numeric params with the locale', () => {
    expect(formatIcu('{n} XP', { n: 12345 }, 'pt-BR')).toBe('12.345 XP');
    expect(formatIcu('{n} XP', { n: 12345 }, 'en-US')).toBe('12,345 XP');
  });
  it('supports legacy {{ name }} placeholders', () => {
    expect(formatIcu('Hi {{ name }}!', { name: 'Ana' }, 'en-US')).toBe(
      'Hi Ana!',
    );
  });
  it('supports dotted params', () => {
    expect(formatIcu('Hi {user.name}', { user: { name: 'Bo' } }, 'en-US')).toBe(
      'Hi Bo',
    );
  });
  it('leaves unknown params visible', () => {
    expect(formatIcu('Hi {name}', {}, 'en-US')).toBe('Hi {name}');
    expect(formatIcu('Hi {name}', undefined, 'en-US')).toBe('Hi {name}');
  });
  it('handles plural with exact, one, other and #', () => {
    const msg = '{count, plural, =0 {Sem ofensiva} one {# dia} other {# dias}}';
    expect(formatIcu(msg, { count: 0 }, 'pt-BR')).toBe('Sem ofensiva');
    expect(formatIcu(msg, { count: 1 }, 'pt-BR')).toBe('1 dia');
    expect(formatIcu(msg, { count: 1500 }, 'pt-BR')).toBe('1.500 dias');
  });
  it('handles nested params inside plural branches', () => {
    const msg =
      '{count, plural, one {{name} has # badge} other {{name} has # badges}}';
    expect(formatIcu(msg, { count: 2, name: 'Ana' }, 'en-US')).toBe(
      'Ana has 2 badges',
    );
  });
  it('supports offset', () => {
    const msg =
      '{n, plural, offset:1 =0 {nobody} =1 {you} one {you and # other} other {you and # others}}';
    expect(formatIcu(msg, { n: 1 }, 'en-US')).toBe('you');
    expect(formatIcu(msg, { n: 2 }, 'en-US')).toBe('you and 1 other');
    expect(formatIcu(msg, { n: 4 }, 'en-US')).toBe('you and 3 others');
  });
  it('handles select', () => {
    const msg = '{g, select, female {Ela} male {Ele} other {Elu}} ganhou';
    expect(formatIcu(msg, { g: 'female' }, 'pt-BR')).toBe('Ela ganhou');
    expect(formatIcu(msg, { g: 'x' }, 'pt-BR')).toBe('Elu ganhou');
    expect(formatIcu(msg, {}, 'pt-BR')).toBe('Elu ganhou');
  });
  it('leaves a plural untouched when its param is missing', () => {
    const msg = '{n, plural, one {#} other {#}}';
    expect(formatIcu(msg, {}, 'en-US')).toBe(msg);
  });
  it('treats unsupported formatters as plain args and escapes quotes', () => {
    expect(formatIcu('{n, number} pts', { n: 3 }, 'en-US')).toBe('3 pts');
    expect(formatIcu("it''s", {}, 'en-US')).toBe("it's");
  });
  it('keeps malformed braces literally', () => {
    expect(formatIcu('a { b', {}, 'en-US')).toBe('a { b');
    expect(formatIcu('{not valid}', {}, 'en-US')).toBe('{not valid}');
  });
  it('compiles once, formats many times', () => {
    const fn = compileIcu('{n, plural, one {# coin} other {# coins}}', 'en-US');
    expect(fn({ n: 1 })).toBe('1 coin');
    expect(fn({ n: 5 })).toBe('5 coins');
  });
  it('needsIcu skips plain strings', () => {
    expect(needsIcu('Save')).toBe(false);
    expect(needsIcu('+{value} XP')).toBe(true);
  });
});

describe('shared string bundles', () => {
  function keys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) return [prefix];
    return Object.entries(obj).flatMap(([k, v]) =>
      keys(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it('pt-BR and en-US define exactly the same keys', () => {
    const pt = keys(TRANSLATION_BUNDLES['pt-BR']).sort();
    const en = keys(TRANSLATION_BUNDLES['en-US']).sort();
    expect(pt.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !pt.includes(k))).toEqual([]);
  });

  it('every string parses and renders without throwing', () => {
    for (const locale of ['pt-BR', 'en-US'] as const) {
      for (const key of keys(TRANSLATION_BUNDLES[locale])) {
        const value = key
          .split('.')
          .reduce<unknown>(
            (o, k) => (o as Record<string, unknown>)[k],
            TRANSLATION_BUNDLES[locale],
          );
        expect(typeof value).toBe('string');
        expect(() =>
          formatIcu(value as string, { count: 2, value: 3 }, locale),
        ).not.toThrow();
      }
    }
  });
});
