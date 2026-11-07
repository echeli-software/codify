import {
  Email,
  Slug,
  LocaleCode,
  Currency,
  HexColor,
  DisplayName,
} from './primitives.js';

describe('Email', () => {
  it('accepts and lowercases', () => {
    expect(Email.parse('Foo@Bar.COM')).toBe('foo@bar.com');
  });
  it('rejects garbage', () => {
    expect(() => Email.parse('not-an-email')).toThrow();
  });
});

describe('Slug', () => {
  it.each(['react-fundamentals', 'frontend', 'a-b-c', 'abc'])(
    'accepts %s',
    (s) => {
      expect(Slug.parse(s)).toBe(s);
    },
  );
  it.each([
    '-leading',
    'trailing-',
    'double--hyphen',
    'WithCaps',
    'sp ace',
    'ab',
    'x'.repeat(61),
  ])('rejects %s', (s) => {
    expect(() => Slug.parse(s)).toThrow();
  });
});

describe('LocaleCode', () => {
  it.each(['pt-BR', 'en-US', 'es-419', 'pt', 'zh-Hans-CN'])(
    'accepts %s',
    (l) => {
      expect(LocaleCode.parse(l)).toBe(l);
    },
  );
  it.each(['PT-BR', 'pt_BR', 'p', '123'])('rejects %s', (l) => {
    expect(() => LocaleCode.parse(l)).toThrow();
  });
});

describe('Currency', () => {
  it('accepts BRL/USD/EUR', () => {
    expect(Currency.parse('BRL')).toBe('BRL');
    expect(Currency.parse('USD')).toBe('USD');
  });
  it('rejects lowercase or wrong length', () => {
    expect(() => Currency.parse('brl')).toThrow();
    expect(() => Currency.parse('US')).toThrow();
  });
});

describe('HexColor', () => {
  it.each(['#fff', '#FFFFFF', '#1a2b3c'])('accepts %s', (c) => {
    expect(HexColor.parse(c)).toBe(c);
  });
  it.each(['fff', '#ggg', '#1234', 'rgb(0,0,0)'])('rejects %s', (c) => {
    expect(() => HexColor.parse(c)).toThrow();
  });
});

describe('DisplayName', () => {
  it('trims and accepts unicode', () => {
    expect(DisplayName.parse('  João  ')).toBe('João');
  });
  it('rejects empty after trim', () => {
    expect(() => DisplayName.parse('   ')).toThrow();
  });
});
