import { formatCurrency, formatInstallmentAmount } from './currency.js';
import {
  formatXp,
  formatCoins,
  formatCompact,
  formatMultiplier,
} from './numbers.js';
import { formatDuration } from './duration.js';
import { formatRelative } from './relative.js';

describe('formatCurrency', () => {
  it('formats BRL for pt-BR', () => {
    expect(formatCurrency(3990, 'BRL', 'pt-BR').replace(/\u00a0/g, ' ')).toBe(
      'R$ 39,90',
    );
  });
  it('formats USD for en-US', () => {
    expect(formatCurrency(999, 'USD', 'en-US')).toBe('$9.99');
  });
  it('handles negative cents', () => {
    expect(formatCurrency(-100, 'USD', 'en-US')).toBe('-$1.00');
  });
  it('non-finite cents → 0', () => {
    expect(formatCurrency(NaN, 'USD', 'en-US')).toBe('$0.00');
  });
  it('hideSymbol returns digits only', () => {
    expect(formatCurrency(1234, 'USD', 'en-US', { hideSymbol: true })).toBe(
      '12.34',
    );
  });
});

describe('formatInstallmentAmount', () => {
  it('divides equally', () => {
    expect(
      formatInstallmentAmount(47880, 12, 'BRL', 'pt-BR').replace(
        /\u00a0/g,
        ' ',
      ),
    ).toBe('R$ 39,90');
  });
  it('handles count=0 by treating as 1', () => {
    const out = formatInstallmentAmount(999, 0, 'USD', 'en-US');
    expect(out).toBe('$9.99');
  });
});

describe('numbers', () => {
  it('formatXp adds thousands', () => {
    expect(formatXp(12345, 'en-US')).toBe('12,345');
    expect(formatXp(12345, 'pt-BR')).toBe('12.345');
  });
  it('formatCoins same shape as XP', () => {
    expect(formatCoins(7, 'en-US')).toBe('7');
  });
  it('formatCompact shortens', () => {
    expect(formatCompact(12345, 'en-US')).toBe('12.3K');
  });
  it('formatMultiplier whole vs fractional', () => {
    expect(formatMultiplier(2, 'en-US')).toBe('2x');
    expect(formatMultiplier(1.5, 'en-US')).toBe('1.5x');
    expect(formatMultiplier(2.475, 'en-US')).toBe('2.48x');
  });
  it('formatMultiplier zero/neg → 1x', () => {
    expect(formatMultiplier(0, 'en-US')).toBe('1x');
    expect(formatMultiplier(-3, 'en-US')).toBe('1x');
  });
});

describe('formatDuration', () => {
  it('< 60s → seconds', () => {
    expect(formatDuration(45_000)).toEqual({ value: 45, unit: 'second' });
  });
  it('< 60min → minutes', () => {
    expect(formatDuration(120_000)).toEqual({ value: 2, unit: 'minute' });
  });
  it('< 48h → hours', () => {
    expect(formatDuration(3 * 60 * 60 * 1000)).toEqual({
      value: 3,
      unit: 'hour',
    });
  });
  it('≥ 48h → days', () => {
    expect(formatDuration(72 * 60 * 60 * 1000)).toEqual({
      value: 3,
      unit: 'day',
    });
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-05-03T12:00:00Z');
  it('< 30s → "now"', () => {
    expect(
      formatRelative(new Date('2026-05-03T12:00:10Z'), 'en-US', now),
    ).toMatch(/now/i);
  });
  it('5 minutes ago', () => {
    expect(
      formatRelative(new Date('2026-05-03T11:55:00Z'), 'en-US', now),
    ).toMatch(/5 minutes ago/);
  });
  it('in 2 hours', () => {
    expect(
      formatRelative(new Date('2026-05-03T14:00:00Z'), 'en-US', now),
    ).toMatch(/in 2 hours/);
  });
});
