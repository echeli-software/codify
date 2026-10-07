import {
  annualSavings,
  currencyDecimals,
  formatMoney,
  formatPrice,
  splitInstallments,
} from './billing.js';

// Intl currency formatting inserts a non-breaking space (U+00A0) between
// the symbol and the number for pt-BR; normalize so assertions read cleanly.
const norm = (s: string) => s.replace(/\u00a0/g, ' ');

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
    expect(
      norm(
        formatPrice(
          { currency: 'BRL', amountCents: 3990, period: 'MONTHLY' },
          'pt-BR',
        ),
      ),
    ).toBe('R$ 39,90/mês');
  });

  it('monthly en-US', () => {
    expect(
      norm(
        formatPrice(
          { currency: 'USD', amountCents: 999, period: 'MONTHLY' },
          'en-US',
        ),
      ),
    ).toBe('$9.99/mo');
  });

  it('annual pt-BR with savings shows equivalent + economize', () => {
    const out = norm(
      formatPrice(
        { currency: 'BRL', amountCents: 47880, period: 'ANNUAL' },
        'pt-BR',
        { annualSavingsFraction: 0.2 },
      ),
    );
    expect(out).toBe(
      'R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%',
    );
  });

  it('annual pt-BR with installments (no savings clause)', () => {
    const out = norm(
      formatPrice(
        {
          currency: 'BRL',
          amountCents: 47880,
          period: 'ANNUAL',
          maxInstallments: 12,
        },
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
    expect(
      norm(
        formatPrice(
          { currency: 'USD', amountCents: 500, period: 'MONTHLY' },
          'fr-FR',
        ),
      ),
    ).toContain('/mo');
  });
});

describe('installments', () => {
  it('never rounds the installment up — notes the remainder instead', () => {
    // 49990 / 12 = 4165.83… → 12x R$ 41,65 = R$ 499,80, remainder R$ 0,10
    const out = norm(
      formatPrice(
        {
          currency: 'BRL',
          amountCents: 49990,
          period: 'ANNUAL',
          maxInstallments: 12,
        },
        'pt-BR',
      ),
    );
    expect(out).toBe(
      'R$ 499,90/ano ou em até 12x de R$ 41,65 sem juros (+ R$ 0,10 na 1ª parcela)',
    );
  });

  it('en-US remainder wording', () => {
    const out = norm(
      formatPrice(
        {
          currency: 'USD',
          amountCents: 10000,
          period: 'ANNUAL',
          maxInstallments: 3,
        },
        'en-US',
      ),
    );
    expect(out).toBe(
      '$100.00/yr or up to 3x of $33.33 interest-free (+$0.01 on the first installment)',
    );
  });

  it('splitInstallments always sums back to the total', () => {
    for (const total of [47880, 49990, 1, 11, 99999]) {
      for (let n = 1; n <= 12; n++) {
        const s = splitInstallments(total, n);
        expect(s.perInstallment * s.count + s.remainder).toBe(total);
        expect(s.remainder).toBeGreaterThanOrEqual(0);
        expect(s.remainder).toBeLessThan(n);
      }
    }
  });

  it('shows savings and installments together on an annual card price', () => {
    const out = norm(
      formatPrice(
        {
          currency: 'BRL',
          amountCents: 47880,
          period: 'ANNUAL',
          maxInstallments: 12,
        },
        'pt-BR',
        { annualSavingsFraction: 0.2 },
      ),
    );
    expect(out).toBe(
      'R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros · economize 20%',
    );
  });

  it('installments: false falls back to the equivalent-per-month label (PIX/Boleto)', () => {
    const out = norm(
      formatPrice(
        {
          currency: 'BRL',
          amountCents: 47880,
          period: 'ANNUAL',
          maxInstallments: 12,
        },
        'pt-BR',
        { annualSavingsFraction: 0.2, installments: false },
      ),
    );
    expect(out).toBe(
      'R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%',
    );
  });

  it('monthly prices never show installments', () => {
    const out = norm(
      formatPrice(
        {
          currency: 'BRL',
          amountCents: 3990,
          period: 'MONTHLY',
          maxInstallments: 12,
        },
        'pt-BR',
      ),
    );
    expect(out).toBe('R$ 39,90/mês');
  });
});

describe('zero-decimal currencies', () => {
  it('reports Stripe decimal places', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('jpy')).toBe(0);
    expect(currencyDecimals('BRL')).toBe(2);
    expect(currencyDecimals('KWD')).toBe(3);
  });

  it('formats JPY amounts as whole yen (no ÷100)', () => {
    expect(norm(formatMoney(1200, 'JPY', 'en-US'))).toBe('¥1,200');
    expect(
      norm(
        formatPrice(
          { currency: 'JPY', amountCents: 980, period: 'MONTHLY' },
          'en-US',
        ),
      ),
    ).toBe('¥980/mo');
  });

  it('splits zero-decimal installments in whole units', () => {
    const out = norm(
      formatPrice(
        {
          currency: 'JPY',
          amountCents: 12000,
          period: 'ANNUAL',
          maxInstallments: 7,
        },
        'en-US',
      ),
    );
    // 12000 / 7 = 1714.28… → 7x ¥1,714 + ¥2
    expect(out).toBe(
      '¥12,000/yr or up to 7x of ¥1,714 interest-free (+¥2 on the first installment)',
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
