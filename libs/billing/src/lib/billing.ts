/**
 * Pure billing helpers shared by admin + student apps and the API.
 *
 * The headline export is `formatPrice`, which turns a `PlanPriceLike`
 * (currency + integer minor units + billing period + optional installments)
 * into the canonical localized strings specced in /docs/09-billing.md §8.
 *
 * No framework deps — just `Intl.NumberFormat` — so it is unit-testable
 * and reusable on the server (e.g. for transactional emails) too.
 */

export type BillingPeriod = 'MONTHLY' | 'ANNUAL';

export interface PlanPriceLike {
  currency: string; // ISO-4217, e.g. "BRL"
  /**
   * Amount in the currency's smallest unit, exactly as Stripe stores it:
   * cents for BRL/USD, whole yen for JPY (a zero-decimal currency).
   */
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
  /**
   * Show the installments clause for an annual price that allows them
   * (default true). Pass false when the selected method can't split
   * payments (PIX / Boleto).
   */
  installments?: boolean;
  /** Override the default per-locale month/year/equivalent words. */
  strings?: Partial<PriceStrings>;
}

export interface PriceStrings {
  perMonth: string;
  perYear: string;
  equivalent: string; // "{x}/mo equivalent"
  save: string; // "save {n}%"
  installments: string; // "or up to {n}x of {x} interest-free"
  /** Appended when the total doesn't split evenly: "(+{r} on the 1st)". */
  installmentsRemainder: string;
}

const STRINGS_BY_LANG: Record<string, PriceStrings> = {
  pt: {
    perMonth: '/mês',
    perYear: '/ano',
    equivalent: '{x}/mês equivalente',
    save: 'economize {n}%',
    installments: 'ou em até {n}x de {x} sem juros',
    installmentsRemainder: '(+ {r} na 1ª parcela)',
  },
  en: {
    perMonth: '/mo',
    perYear: '/yr',
    equivalent: '{x}/mo equivalent',
    save: 'save {n}%',
    installments: 'or up to {n}x of {x} interest-free',
    installmentsRemainder: '(+{r} on the first installment)',
  },
};

function stringsForLocale(locale: string): PriceStrings {
  const lang = locale.toLowerCase().split('-')[0];
  return STRINGS_BY_LANG[lang] ?? STRINGS_BY_LANG['en'];
}

/**
 * Stripe's zero-decimal currencies: the stored amount is already in whole
 * units (https://docs.stripe.com/currencies#zero-decimal).
 */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** Stripe's three-decimal currencies. */
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Number of decimal places in the currency's smallest unit (Stripe semantics). */
export function currencyDecimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** Format an amount in minor units into a localized currency string (no period suffix). */
export function formatMoney(
  amountCents: number,
  currency: string,
  locale: string,
): string {
  const decimals = currencyDecimals(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amountCents / 10 ** decimals);
}

export interface InstallmentSplit {
  count: number;
  /** Each installment, rounded down to the smallest currency unit. */
  perInstallment: number;
  /** What the rounded-down installments leave over (added to the first). */
  remainder: number;
}

/**
 * Split a total into `count` interest-free installments without inventing
 * money: every installment is the rounded-down share and the leftover
 * minor units (`remainder`, always < count) go on the first one, so
 * `perInstallment * count + remainder === total` exactly.
 */
export function splitInstallments(
  totalMinor: number,
  count: number,
): InstallmentSplit {
  const n = Math.max(1, Math.floor(count));
  const perInstallment = Math.floor(totalMinor / n);
  return {
    count: n,
    perInstallment,
    remainder: totalMinor - perInstallment * n,
  };
}

/**
 * Canonical price label. Examples (see /docs/09-billing.md §8):
 *   pt-BR MONTHLY                → "R$ 39,90/mês"
 *   pt-BR ANNUAL (savings .2)    → "R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%"
 *   pt-BR ANNUAL + 12x           → "R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros"
 *   pt-BR ANNUAL + 12x + savings → "R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros · economize 20%"
 *   en-US MONTHLY                → "$9.99/mo"
 *
 * The installment amount is never rounded up: when the total doesn't
 * divide evenly the label shows the rounded-down installment and notes
 * the remainder charged on the first one ("12x de R$ 41,65 sem juros
 * (+ R$ 0,10 na 1ª parcela)"), so the label always sums to the price.
 */
export function formatPrice(
  price: PlanPriceLike,
  locale: string,
  opts: FormatPriceOptions = {},
): string {
  const s = { ...stringsForLocale(locale), ...opts.strings };
  const money = (minor: number) => formatMoney(minor, price.currency, locale);
  const total = money(price.amountCents);

  if (price.period === 'MONTHLY') {
    return `${total}${s.perMonth}`;
  }

  // ANNUAL
  const head = `${total}${s.perYear}`;
  const savings =
    opts.annualSavingsFraction != null && opts.annualSavingsFraction > 0
      ? s.save.replace(
          '{n}',
          String(Math.round(opts.annualSavingsFraction * 100)),
        )
      : null;

  const installments = opts.installments ?? true;
  if (installments && price.maxInstallments && price.maxInstallments > 1) {
    const split = splitInstallments(price.amountCents, price.maxInstallments);
    let clause = s.installments
      .replace('{n}', String(split.count))
      .replace('{x}', money(split.perInstallment));
    if (split.remainder > 0) {
      clause += ` ${s.installmentsRemainder.replace('{r}', money(split.remainder))}`;
    }
    const withInstallments = `${head} ${clause}`;
    return savings ? `${withInstallments} · ${savings}` : withInstallments;
  }

  // Equivalent-per-month + optional savings path. The equivalent is an
  // approximation by nature ("equivalente"), so it rounds to nearest.
  const parts = [
    head,
    s.equivalent.replace('{x}', money(Math.round(price.amountCents / 12))),
  ];
  if (savings) parts.push(savings);
  return parts.join(' · ');
}

/**
 * Savings fraction of an annual price vs. paying the monthly price 12×.
 * Returns 0 when there's no monthly counterpart or annual isn't cheaper.
 */
export function annualSavings(
  annualCents: number,
  monthlyCents: number,
): number {
  if (monthlyCents <= 0) return 0;
  const fullYear = monthlyCents * 12;
  if (annualCents >= fullYear) return 0;
  return (fullYear - annualCents) / fullYear;
}
