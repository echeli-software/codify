import { annualSavings, formatMoney, formatPrice } from './billing.js';

// Intl currency formatting inserts a non-breaking space (U+00A0) between
// the symbol and the number for pt-BR; normalize so assertions read cleanly.
const norm = (s: string) => s.replace(/ /g, ' ');

describe('formatMoney', () => {
  it('formats BRL with pt-BR separators', () => {
    expect(norm(formatMoney(3990, 'BRL', 'pt-BR'))).toBe('R$ 39,90');
    expect(norm(formatMoney(47880, 'BRL', 'pt-BR'))).toBe('R$ 478,80');
  });

  it('formats USD with en-US separators', () => {
    expect(norm(formatMoney(999, 'USD', 'en-US'))).toBe('$9.99');
  });
});

describe('formatPrice', () => {
  it('monthly pt-BR', () => {
    expect(norm(formatPrice({ currency: 'BRL', amountCents: 3990, period: 'MONTHLY' }, 'pt-BR'))).toBe(
      'R$ 39,90/mês',
    );
  });

  it('monthly en-US', () => {
    expect(norm(formatPrice({ currency: 'USD', amountCents: 999, period: 'MONTHLY' }, 'en-US'))).toBe(
      '$9.99/mo',
    );
  });

  it('annual pt-BR with savings shows equivalent + economize', () => {
    const out = norm(
      formatPrice(
        { currency: 'BRL', amountCents: 47880, period: 'ANNUAL' },
        'pt-BR',
        { annualSavingsFraction: 0.2 },
      ),
    );
    expect(out).toBe('R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%');
  });

  it('annual pt-BR with installments (no savings clause)', () => {
    const out = norm(
      formatPrice(
        { currency: 'BRL', amountCents: 47880, period: 'ANNUAL', maxInstallments: 12 },
        'pt-BR',
      ),
    );
    expect(out).toBe('R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros');
  });

  it('annual en-US with savings', () => {
    const out = norm(
      formatPrice(
        { currency: 'USD', amountCents: 9990, period: 'ANNUAL' },
        'en-US',
        { annualSavingsFraction: 0.17 },
      ),
    );
    expect(out).toBe('$99.90/yr · $8.33/mo equivalent · save 17%');
  });

  it('falls back to en strings for an unknown locale', () => {
    expect(norm(formatPrice({ currency: 'USD', amountCents: 500, period: 'MONTHLY' }, 'fr-FR'))).toContain(
      '/mo',
    );
  });
});

describe('annualSavings', () => {
  it('computes fraction vs 12x monthly', () => {
    // 12 * 3990 = 47880; annual 38304 → 20% off
    expect(annualSavings(38304, 3990)).toBeCloseTo(0.2, 5);
  });

  it('returns 0 when annual is not cheaper', () => {
    expect(annualSavings(47880, 3990)).toBe(0);
    expect(annualSavings(50000, 3990)).toBe(0);
  });

  it('returns 0 with no monthly counterpart', () => {
    expect(annualSavings(47880, 0)).toBe(0);
  });
});
