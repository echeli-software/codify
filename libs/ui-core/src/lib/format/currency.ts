/**
 * Currency formatting. Money values are stored as integer cents; consumers
 * pass `cents` and a 3-letter ISO 4217 code. Locale governs separators and
 * symbol position. See docs/09-billing.md §8.
 */

export interface FormatCurrencyOptions {
  /** Hide the symbol (just digits + separators). Default false. */
  hideSymbol?: boolean;
  /** Force a fixed number of fraction digits. Default: currency-appropriate. */
  fractionDigits?: number;
}

export function formatCurrency(
  cents: number,
  currency: string,
  locale: string,
  opts: FormatCurrencyOptions = {},
): string {
  if (!Number.isFinite(cents)) cents = 0;
  const amount = cents / 100;
  const formatter = new Intl.NumberFormat(locale, {
    style: opts.hideSymbol ? 'decimal' : 'currency',
    currency,
    minimumFractionDigits: opts.fractionDigits ?? undefined,
    maximumFractionDigits: opts.fractionDigits ?? undefined,
  });
  return formatter.format(amount);
}

/**
 * "12x of R$ 39,90 sem juros" / "12x of $9.99". The phrasing is locale-free
 * here — wrap with i18n at the call site to inject "x" / "de" / "of".
 *
 * Returns just the per-installment amount; the caller assembles the sentence.
 */
export function formatInstallmentAmount(
  totalCents: number,
  count: number,
  currency: string,
  locale: string,
): string {
  if (count <= 0) count = 1;
  const per = Math.round(totalCents / count);
  return formatCurrency(per, currency, locale);
}

export interface FormatInstallmentsInput {
  totalCents: number;
  count: number;
  currency: string;
  locale: string;
}

export interface FormattedInstallments {
  /** Normalised installment count (≥ 1). */
  count: number;
  /** Formatted per-installment amount, e.g. "R$ 39,90". */
  perInstallment: string;
  /** Formatted total, e.g. "R$ 478,80". */
  total: string;
}

/**
 * docs/03 `formatInstallments({ totalCents, count, currency, locale })` —
 * returns the pieces the i18n sentence (`billing.installments`) needs.
 */
export function formatInstallments(
  input: FormatInstallmentsInput,
): FormattedInstallments {
  const count = input.count > 0 ? Math.floor(input.count) : 1;
  return {
    count,
    perInstallment: formatInstallmentAmount(
      input.totalCents,
      count,
      input.currency,
      input.locale,
    ),
    total: formatCurrency(input.totalCents, input.currency, input.locale),
  };
}
