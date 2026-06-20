/**
 * Pure billing helpers shared by admin + student apps and the API.
 *
 * The headline export is `formatPrice`, which turns a `PlanPriceLike`
 * (currency + integer cents + billing period + optional installments)
 * into the canonical localized strings specced in /docs/09-billing.md §8.
 *
 * No framework deps — just `Intl.NumberFormat` — so it is unit-testable
 * and reusable on the server (e.g. for transactional emails) too.
 */

export type BillingPeriod = 'MONTHLY' | 'ANNUAL';

export interface PlanPriceLike {
  currency: string; // ISO-4217, e.g. "BRL"
  amountCents: number;
  period: BillingPeriod;
  /** Brazil parcelamento — up to 12. Null/undefined = no installments. */
  maxInstallments?: number | null;
}

export interface FormatPriceOptions {
  /**
   * Annual savings vs. 12× the equivalent monthly price, as a 0–1 fraction.
   * When provided (and period is ANNUAL) the "save N%" clause is appended.
   * Callers compute this from the plan's monthly price; we don't guess.
   */
  annualSavingsFraction?: number;
  /** Override the default per-locale month/year/equivalent words. */
  strings?: Partial<PriceStrings>;
}

interface PriceStrings {
  perMonth: string;
  perYear: string;
  equivalent: string; // "{x}/mo equivalent"
  save: string; // "save {n}%"
  installments: string; // "or up to {n}x of {x} interest-free"
}

const STRINGS_BY_LANG: Record<string, PriceStrings> = {
  pt: {
    perMonth: '/mês',
    perYear: '/ano',
    equivalent: '{x}/mês equivalente',
    save: 'economize {n}%',
    installments: 'ou em até {n}x de {x} sem juros',
  },
  en: {
    perMonth: '/mo',
    perYear: '/yr',
    equivalent: '{x}/mo equivalent',
    save: 'save {n}%',
    installments: 'or up to {n}x of {x} interest-free',
  },
};

function stringsForLocale(locale: string): PriceStrings {
  const lang = locale.toLowerCase().split('-')[0];
  return STRINGS_BY_LANG[lang] ?? STRINGS_BY_LANG['en'];
}

/** Format integer cents into a localized currency string (no period suffix). */
export function formatMoney(amountCents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amountCents / 100);
}

/**
 * Canonical price label. Examples (see /docs/09-billing.md §8):
 *   pt-BR MONTHLY                → "R$ 39,90/mês"
 *   pt-BR ANNUAL (savings .2)    → "R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%"
 *   pt-BR ANNUAL + 12x           → "R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros"
 *   en-US MONTHLY                → "$9.99/mo"
 *
 * When both `annualSavingsFraction` and installments apply, the savings
 * clause wins (it's the primary value message); installments are shown by
 * passing no savings, matching the doc's two annual rows.
 */
export function formatPrice(
  price: PlanPriceLike,
  locale: string,
  opts: FormatPriceOptions = {},
): string {
  const s = { ...stringsForLocale(locale), ...opts.strings };
  const total = formatMoney(price.amountCents, price.currency, locale);

  if (price.period === 'MONTHLY') {
    return `${total}${s.perMonth}`;
  }

  // ANNUAL
  const head = `${total}${s.perYear}`;

  // Installments path — only when no explicit savings clause is requested.
  if (price.maxInstallments && price.maxInstallments > 1 && opts.annualSavingsFraction == null) {
    const per = formatMoney(
      Math.round(price.amountCents / price.maxInstallments),
      price.currency,
      locale,
    );
    return `${head} ${s.installments.replace('{n}', String(price.maxInstallments)).replace('{x}', per)}`;
  }

  // Equivalent-per-month + optional savings path.
  const monthlyEquivalent = formatMoney(
    Math.round(price.amountCents / 12),
    price.currency,
    locale,
  );
  const parts = [head, s.equivalent.replace('{x}', monthlyEquivalent)];
  if (opts.annualSavingsFraction != null && opts.annualSavingsFraction > 0) {
    const pct = Math.round(opts.annualSavingsFraction * 100);
    parts.push(s.save.replace('{n}', String(pct)));
  }
  return parts.join(' · ');
}

/**
 * Savings fraction of an annual price vs. paying the monthly price 12×.
 * Returns 0 when there's no monthly counterpart or annual isn't cheaper.
 */
export function annualSavings(annualCents: number, monthlyCents: number): number {
  if (monthlyCents <= 0) return 0;
  const fullYear = monthlyCents * 12;
  if (annualCents >= fullYear) return 0;
  return (fullYear - annualCents) / fullYear;
}
