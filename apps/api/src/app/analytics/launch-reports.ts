/**
 * Pure parts of the Phase 14 launch-decision reports (docs/15 Phase 14,
 * docs/10 §10): the learners-by-country breakdown and the monthly-BRL
 * "card only" checkout funnel. ReportsService runs the queries.
 */

/** Countries listed by name; the rest are summed into "Other". */
export const COUNTRY_TOP_N = 10;
/** Window of the monthly-PIX funnel. */
export const PIX_FUNNEL_DAYS = 30;

/** Subscription-page events behind the funnel (docs/10 §14 Billing). */
export const CHECKOUT_EVENTS = {
  unavailable: 'checkout_method_unavailable',
  start: 'checkout_start',
  exit: 'subscription_page_exit',
} as const;

export interface CountryCounts {
  /** ISO 3166-1 alpha-2, or null when unknown. */
  country: string | null;
  learners: number;
  /** Seen (lastSeenAt) in the last 7 / 30 days. */
  active7: number;
  active30: number;
  /** With an ACTIVE / PAST_DUE paid (web or store) subscription. */
  paid: number;
}

export interface CountryRow extends CountryCounts {
  kind: 'country' | 'other' | 'unknown';
  /** Countries folded into an "Other" row (0 otherwise). */
  countries: number;
}

export interface CountryReport {
  /** Top COUNTRY_TOP_N by learners, then "Other", then "Unknown". */
  rows: CountryRow[];
  total: CountryCounts;
}

const ZERO = { learners: 0, active7: 0, active30: 0, paid: 0 };

function add<T extends Omit<CountryCounts, 'country'>>(
  into: T,
  r: Omit<CountryCounts, 'country'>,
): T {
  into.learners += r.learners;
  into.active7 += r.active7;
  into.active30 += r.active30;
  into.paid += r.paid;
  return into;
}

/**
 * Per-country counts → the report rows: the top `topN` countries by
 * learners (ties by code), one "Other" row for the rest, one "Unknown" row
 * for users without a country. Empty buckets are left out.
 */
export function rollupCountries(
  counts: readonly CountryCounts[],
  topN = COUNTRY_TOP_N,
): CountryReport {
  const total = add({ country: null, ...ZERO }, { ...ZERO });
  const unknown: CountryRow = {
    country: null,
    kind: 'unknown',
    countries: 0,
    ...ZERO,
  };
  const known = new Map<string, CountryCounts>();
  for (const c of counts) {
    add(total, c);
    if (!c.country) {
      add(unknown, c);
      continue;
    }
    const code = c.country.toUpperCase();
    const prev = known.get(code) ?? { country: code, ...ZERO };
    known.set(code, add(prev, c));
  }
  const sorted = [...known.values()].sort(
    (a, b) =>
      b.learners - a.learners ||
      (a.country ?? '').localeCompare(b.country ?? ''),
  );
  const rows: CountryRow[] = sorted
    .slice(0, topN)
    .map((c) => ({ ...c, kind: 'country', countries: 0 }));
  const rest = sorted.slice(topN);
  if (rest.length) {
    const other: CountryRow = {
      country: null,
      kind: 'other',
      countries: rest.length,
      ...ZERO,
    };
    for (const c of rest) add(other, c);
    rows.push(other);
  }
  if (unknown.learners > 0) rows.push(unknown);
  return { rows, total };
}

/** One subscription-page event, as read for the funnel. */
export interface CheckoutEvent {
  name: string;
  /** `props.visitId`: one subscription-page visit. */
  visitId: string;
  period: string | null;
  method: string | null;
  currency: string | null;
  at: Date;
}

export interface MonthlyPixFunnel {
  days: number;
  /** Visits where a BRL monthly checkout showed "card only". */
  cardOnlySeen: number;
  /** …then started a monthly card checkout. */
  cardCheckout: number;
  /** …then started an annual checkout (any method). */
  switchedAnnual: number;
  /** …of which with PIX or Boleto. */
  switchedAnnualPrepay: number;
  /** …then left without starting a checkout. */
  left: number;
}

function isCardOnlyNotice(e: CheckoutEvent): boolean {
  return (
    e.name === CHECKOUT_EVENTS.unavailable &&
    (e.period ?? '').toUpperCase() === 'MONTHLY' &&
    (e.currency ?? '').toUpperCase() === 'BRL'
  );
}

/**
 * Classifies each visit that met "card only" on a BRL monthly price by the
 * first checkout it started afterwards: annual → switched to annual,
 * monthly → card checkout, none → left (whether or not a
 * `subscription_page_exit` arrived: a closed tab may never send it).
 */
export function monthlyPixFunnel(
  events: readonly CheckoutEvent[],
  days = PIX_FUNNEL_DAYS,
): MonthlyPixFunnel {
  const byVisit = new Map<string, CheckoutEvent[]>();
  for (const e of events) {
    const list = byVisit.get(e.visitId) ?? [];
    list.push(e);
    byVisit.set(e.visitId, list);
  }
  const out: MonthlyPixFunnel = {
    days,
    cardOnlySeen: 0,
    cardCheckout: 0,
    switchedAnnual: 0,
    switchedAnnualPrepay: 0,
    left: 0,
  };
  for (const list of byVisit.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    const seen = list.find(isCardOnlyNotice);
    if (!seen) continue;
    out.cardOnlySeen += 1;
    const start = list.find(
      (e) =>
        e.name === CHECKOUT_EVENTS.start && e.at.getTime() >= seen.at.getTime(),
    );
    if (!start) out.left += 1;
    else if ((start.period ?? '').toUpperCase() === 'ANNUAL') {
      out.switchedAnnual += 1;
      if (start.method === 'pix' || start.method === 'boleto')
        out.switchedAnnualPrepay += 1;
    } else out.cardCheckout += 1;
  }
  return out;
}
