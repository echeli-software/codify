import { countryName } from './country';

describe('countryName', () => {
  it('names a country in the given locale', () => {
    expect(countryName('BR', 'pt-BR')).toBe('Brasil');
    expect(countryName('br', 'en-US')).toBe('Brazil');
    expect(countryName('US', 'en-US')).toBe('United States');
  });

  it('falls back to the code, and null without one', () => {
    expect(countryName('QQ', 'en-US')).toBe('QQ');
    expect(countryName('BR', 'not a locale!')).toBe('BR');
    expect(countryName(null, 'en-US')).toBeNull();
    expect(countryName('', 'en-US')).toBeNull();
  });
});
