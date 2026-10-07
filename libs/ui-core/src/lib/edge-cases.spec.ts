import { contrastRatio, getContrastingTextColor } from './color/index.js';
import {
  formatCoins,
  formatCompact,
  formatCurrency,
  formatDuration,
  formatInstallments,
  formatMultiplier,
  formatRelative,
  formatRelativeDate,
  formatXp,
} from './format/index.js';
import { levelProgress, tierForLevel, xpForLevel } from './level/index.js';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('color edge cases', () => {
  it('treats very dark channels with the linear sRGB segment', () => {
    // 9/255 ≈ 0.035 ≤ 0.03928 → linear segment of the sRGB transfer curve.
    expect(getContrastingTextColor('#090909')).toBe('#ffffff');
    expect(contrastRatio('#090909', '#ffffff')).toBeGreaterThan(19);
  });
  it('rejects hex strings that are the right length but not hex', () => {
    expect(getContrastingTextColor('#gggggg')).toBe('#000000');
    expect(contrastRatio('#gggggg', '#ffffff')).toBe(1);
    expect(contrastRatio('#ffffff', 'nope')).toBe(1);
  });
  it('accepts hex without a leading #', () => {
    expect(getContrastingTextColor('ffffff')).toBe('#000000');
  });
  it('orders luminance regardless of argument order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});

describe('format edge cases', () => {
  it('formatCurrency honours a fixed fraction-digit count', () => {
    expect(formatCurrency(123456, 'USD', 'en-US', { fractionDigits: 0 })).toBe(
      '$1,235',
    );
  });
  it('formatInstallments normalises count and returns total + per', () => {
    const br = formatInstallments({
      totalCents: 47880,
      count: 12,
      currency: 'BRL',
      locale: 'pt-BR',
    });
    expect(br.count).toBe(12);
    expect(nbsp(br.perInstallment)).toBe('R$ 39,90');
    expect(nbsp(br.total)).toBe('R$ 478,80');
    const one = formatInstallments({
      totalCents: 999,
      count: 0,
      currency: 'USD',
      locale: 'en-US',
    });
    expect(one).toEqual({ count: 1, perInstallment: '$9.99', total: '$9.99' });
    expect(
      formatInstallments({
        totalCents: 1000,
        count: 2.7,
        currency: 'USD',
        locale: 'en-US',
      }).count,
    ).toBe(2);
  });
  it('number formatters coerce non-finite input to 0', () => {
    expect(formatXp(Number.NaN, 'en-US')).toBe('0');
    expect(formatCoins(Number.POSITIVE_INFINITY, 'en-US')).toBe('0');
    expect(formatCompact(Number.NaN, 'en-US')).toBe('0');
    expect(formatMultiplier(Number.NaN, 'en-US')).toBe('1x');
  });
  it('formatDuration clamps negative / non-finite input to 0s', () => {
    expect(formatDuration(-5)).toEqual({ value: 0, unit: 'second' });
    expect(formatDuration(Number.NaN)).toEqual({ value: 0, unit: 'second' });
  });
  it('formatRelative picks the largest fitting unit', () => {
    const now = Date.UTC(2026, 0, 31);
    expect(formatRelative(now - 45_000, 'en-US', now)).toMatch(
      /45 seconds ago/,
    );
    expect(formatRelative(now - 86_400_000, 'en-US', now)).toBe('yesterday');
    expect(formatRelative(now + 14 * 86_400_000, 'en-US', now)).toBe(
      'in 2 weeks',
    );
    expect(formatRelative(now - 60 * 86_400_000, 'en-US', now)).toBe(
      '2 months ago',
    );
    expect(formatRelative(now - 2 * 365 * 86_400_000, 'en-US', now)).toBe(
      '2 years ago',
    );
    expect(formatRelative('2026-01-31T00:00:00Z', 'pt-BR', now)).toBe('agora');
    // `now` defaults to the wall clock.
    expect(formatRelative(Date.now() - 5 * 60_000, 'en-US')).toMatch(
      /5 minutes ago/,
    );
  });
  it('formatRelativeDate is the docs/03 alias of formatRelative', () => {
    expect(formatRelativeDate).toBe(formatRelative);
  });
});

describe('level edge cases', () => {
  it('tierForLevel walks every tier boundary', () => {
    expect(tierForLevel(Number.NaN)).toBe('BRONZE');
    expect(tierForLevel(0)).toBe('BRONZE');
    expect(tierForLevel(4)).toBe('BRONZE');
    expect(tierForLevel(5)).toBe('SILVER');
    expect(tierForLevel(10)).toBe('GOLD');
    expect(tierForLevel(20)).toBe('PLATINUM');
    expect(tierForLevel(30)).toBe('DIAMOND');
    expect(tierForLevel(40)).toBe('MYTHIC');
    expect(tierForLevel(50)).toBe('PRESTIGE');
    expect(tierForLevel(999)).toBe('PRESTIGE');
  });
  it('levelProgress stays in [0, 1) across a whole level', () => {
    const base = xpForLevel(7);
    const next = xpForLevel(8);
    for (let xp = base; xp < next; xp += 37) {
      const p = levelProgress(xp);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
    expect(levelProgress(Number.NaN)).toBe(0);
  });
});
