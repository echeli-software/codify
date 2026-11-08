import {
  monthlyPixFunnel,
  rollupCountries,
  type CheckoutEvent,
  type CountryCounts,
} from './launch-reports.js';
import { ReportsService } from './reports.service.js';

const c = (
  country: string | null,
  learners: number,
  extra: Partial<CountryCounts> = {},
): CountryCounts => ({
  country,
  learners,
  active7: 0,
  active30: 0,
  paid: 0,
  ...extra,
});

describe('rollupCountries', () => {
  it('keeps the top N by learners, folds the rest into Other, Unknown last', () => {
    const counts = [
      c(null, 4, { active7: 1, active30: 2, paid: 1 }),
      c('BR', 50, { active7: 10, active30: 30, paid: 5 }),
      c('PT', 8, { active7: 2, active30: 4, paid: 1 }),
      c('US', 8),
      c('AR', 3, { paid: 1 }),
      c('MX', 1, { active30: 1 }),
    ];
    const r = rollupCountries(counts, 3);
    expect(r.rows.map((x) => [x.kind, x.country, x.learners])).toEqual([
      ['country', 'BR', 50],
      ['country', 'PT', 8], // tie with US → by code
      ['country', 'US', 8],
      ['other', null, 4],
      ['unknown', null, 4],
    ]);
    expect(r.rows[3]).toMatchObject({
      countries: 2,
      active30: 1,
      paid: 1,
    });
    expect(r.total).toEqual({
      country: null,
      learners: 74,
      active7: 13,
      active30: 37,
      paid: 8,
    });
  });

  it('defaults to the top 10 and omits empty buckets', () => {
    const counts = Array.from({ length: 10 }, (_, i) =>
      c(String.fromCharCode(65 + i) + 'A', 10 - i),
    );
    const r = rollupCountries(counts);
    expect(r.rows).toHaveLength(10);
    expect(r.rows.every((x) => x.kind === 'country')).toBe(true);
    expect(rollupCountries([]).rows).toEqual([]);
  });

  it('merges codes that differ only in case', () => {
    const r = rollupCountries([c('br', 1), c('BR', 2)]);
    expect(r.rows).toEqual([
      expect.objectContaining({ country: 'BR', learners: 3 }),
    ]);
  });
});

describe('monthlyPixFunnel', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 1, 12, min));
  const ev = (
    visitId: string,
    name: string,
    min: number,
    over: Partial<CheckoutEvent> = {},
  ): CheckoutEvent => ({
    name,
    visitId,
    period: 'MONTHLY',
    method: name === 'checkout_method_unavailable' ? 'pix' : 'card',
    currency: 'BRL',
    at: t(min),
    ...over,
  });

  it('classifies each card-only visit by the first checkout after it', () => {
    const f = monthlyPixFunnel([
      // card checkout
      ev('v1', 'checkout_method_unavailable', 0),
      ev('v1', 'checkout_start', 1),
      // switched to annual with PIX, then also a monthly try (ignored)
      ev('v2', 'checkout_method_unavailable', 0),
      ev('v2', 'checkout_start', 2, { period: 'ANNUAL', method: 'pix' }),
      ev('v2', 'checkout_start', 3),
      // switched to annual by card
      ev('v3', 'checkout_method_unavailable', 0),
      ev('v3', 'checkout_start', 2, { period: 'ANNUAL' }),
      // left (explicit exit or not)
      ev('v4', 'checkout_method_unavailable', 0),
      ev('v4', 'subscription_page_exit', 5),
      ev('v5', 'checkout_method_unavailable', 0),
    ]);
    expect(f).toEqual({
      days: 30,
      cardOnlySeen: 5,
      cardCheckout: 1,
      switchedAnnual: 2,
      switchedAnnualPrepay: 1,
      left: 2,
    });
  });

  it('ignores visits without a BRL monthly card-only notice', () => {
    const f = monthlyPixFunnel([
      ev('a', 'checkout_start', 1),
      ev('b', 'checkout_method_unavailable', 0, { currency: 'USD' }),
      ev('c', 'checkout_method_unavailable', 0, { period: 'ANNUAL' }),
    ]);
    expect(f.cardOnlySeen).toBe(0);
  });

  it('a checkout started before the notice does not count', () => {
    const f = monthlyPixFunnel([
      ev('v', 'checkout_start', 0, { period: 'ANNUAL' }),
      ev('v', 'checkout_method_unavailable', 1),
    ]);
    expect(f).toMatchObject({ cardOnlySeen: 1, left: 1, switchedAnnual: 0 });
  });

  it('orders events by time whatever the input order', () => {
    const f = monthlyPixFunnel([
      ev('v', 'checkout_start', 3),
      ev('v', 'checkout_start', 2, { period: 'ANNUAL', method: 'boleto' }),
      ev('v', 'checkout_method_unavailable', 1),
    ]);
    expect(f).toMatchObject({ switchedAnnual: 1, switchedAnnualPrepay: 1 });
  });
});

describe('ReportsService launch reports', () => {
  it('maps the country and funnel queries', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        { country: 'BR', learners: 3n, a7: 1n, a30: 2n, paid: 1n },
        { country: null, learners: 1n, a7: 0n, a30: 0n, paid: 0n },
      ])
      .mockResolvedValueOnce([
        {
          name: 'checkout_method_unavailable',
          visit: 'v1',
          period: 'MONTHLY',
          method: 'pix',
          currency: 'BRL',
          at: new Date('2026-11-01T00:00:00Z'),
        },
      ]);
    const svc = new ReportsService({ $queryRaw: queryRaw } as never);
    const now = new Date('2026-11-08T12:00:00Z');
    const countries = await svc.countries(now);
    expect(countries.rows).toEqual([
      {
        country: 'BR',
        kind: 'country',
        countries: 0,
        learners: 3,
        active7: 1,
        active30: 2,
        paid: 1,
      },
      {
        country: null,
        kind: 'unknown',
        countries: 0,
        learners: 1,
        active7: 0,
        active30: 0,
        paid: 0,
      },
    ]);
    const pix = await svc.monthlyPix(now);
    expect(pix).toMatchObject({ cardOnlySeen: 1, left: 1 });
    // The window starts 30 days back.
    const params = (queryRaw.mock.calls[1] as unknown[]).slice(1);
    expect(params).toContainEqual(new Date('2026-10-09T12:00:00Z'));
  });
});
