import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18n } from '@codify/i18n';
import type { CountryReport, MonthlyPixFunnel } from '@codify/api-client';
import {
  CountryReportCard,
  MonthlyPixCard,
  pixFunnelRows,
  share,
} from './launch-report-cards.component';

const funnel: MonthlyPixFunnel = {
  days: 30,
  cardOnlySeen: 10,
  cardCheckout: 3,
  switchedAnnual: 4,
  switchedAnnualPrepay: 2,
  left: 3,
};

const report: CountryReport = {
  rows: [
    {
      country: 'BR',
      kind: 'country',
      countries: 0,
      learners: 40,
      active7: 10,
      active30: 25,
      paid: 6,
    },
    {
      country: null,
      kind: 'other',
      countries: 3,
      learners: 5,
      active7: 1,
      active30: 2,
      paid: 0,
    },
    {
      country: null,
      kind: 'unknown',
      countries: 0,
      learners: 2,
      active7: 0,
      active30: 1,
      paid: 0,
    },
  ],
  total: { country: null, learners: 47, active7: 11, active30: 28, paid: 6 },
};

describe('launch report cards', () => {
  it('share is capped at 1 and null without a base', () => {
    expect(share(3, 10)).toBe(0.3);
    expect(share(12, 10)).toBe(1);
    expect(share(1, 0)).toBeNull();
  });

  it('funnel rows: each outcome as a share of "card only"', () => {
    expect(
      pixFunnelRows(funnel).map((r) => [r.key.split('.').pop(), r.share]),
    ).toEqual([
      ['cardOnlySeen', null],
      ['cardCheckout', 0.3],
      ['switchedAnnual', 0.4],
      ['switchedAnnualPrepay', 0.2],
      ['left', 0.3],
    ]);
  });

  async function render<T>(cmp: Type<T>, inputs: object) {
    await TestBed.configureTestingModule({
      imports: [cmp],
      providers: [provideI18n()],
    }).compileComponents();
    const fixture = TestBed.createComponent(cmp);
    for (const [k, v] of Object.entries(inputs))
      fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders one row per bucket plus a total', async () => {
    const el = await render(CountryReportCard, { report });
    const rows = el.querySelectorAll('tbody tr');
    expect(Array.from(rows, (r) => r.getAttribute('data-country'))).toEqual([
      'BR',
      'other',
      'unknown',
    ]);
    expect(rows[0].textContent).toContain('(BR)');
    expect(el.querySelector('tfoot')?.textContent).toContain('47');
  });

  it('shows an empty note with no learners', async () => {
    const el = await render(CountryReportCard, {
      report: { rows: [], total: report.total },
    });
    expect(el.querySelector('[data-testid="countries-table"]')).toBeNull();
  });

  it('renders the funnel table, or the empty note', async () => {
    const el = await render(MonthlyPixCard, { funnel });
    expect(
      el.querySelectorAll('[data-testid="monthly-pix-table"] tbody tr'),
    ).toHaveLength(5);
    TestBed.resetTestingModule();
    const empty = await render(MonthlyPixCard, {
      funnel: { ...funnel, cardOnlySeen: 0 },
    });
    expect(empty.querySelector('[data-testid="monthly-pix-table"]')).toBeNull();
  });
});
