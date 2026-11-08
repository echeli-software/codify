import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  I18nService,
  LocalePipe,
  TranslatePipe,
  formatForLocale,
} from '@codify/i18n';
import type {
  CountryReport,
  CountryReportRow,
  MonthlyPixFunnel,
} from '@codify/api-client';
import { countryName } from '../core/country';

/** Share of `n` in `of` (0–1), null when `of` is 0. */
export function share(n: number, of: number): number | null {
  return of > 0 ? Math.min(1, n / of) : null;
}

/** The funnel as table rows: label key, count, share of "card only". */
export function pixFunnelRows(
  f: MonthlyPixFunnel,
): { key: string; count: number; share: number | null; sub: boolean }[] {
  const of = f.cardOnlySeen;
  const row = (key: keyof MonthlyPixFunnel, sub = false) => ({
    key: `admin.staff.analytics.monthlyPix.${key}`,
    count: f[key],
    share: key === 'cardOnlySeen' ? null : share(f[key], of),
    sub,
  });
  return [
    row('cardOnlySeen'),
    row('cardCheckout'),
    row('switchedAnnual'),
    row('switchedAnnualPrepay', true),
    row('left'),
  ];
}

/**
 * Learners by country (docs/15 Phase 14): top 10 by learners, "Other",
 * "Unknown", with active (7 / 30 days) and paid users. ADMIN overview.
 */
@Component({
  selector: 'cdf-country-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LocalePipe],
  template: `
    <section class="admin-card" aria-labelledby="countries-report">
      <h2 id="countries-report">
        {{ 'admin.staff.analytics.countries.title' | translate }}
      </h2>
      <p class="muted small">
        {{ 'admin.staff.analytics.countries.help' | translate }}
      </p>
      @if (report().rows.length === 0) {
        <p class="muted small">
          {{ 'admin.staff.analytics.countries.empty' | translate }}
        </p>
      } @else {
        <div class="table-scroll">
          <table class="admin-table" data-testid="countries-table">
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.staff.analytics.countries.country' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.analytics.countries.learners' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.analytics.countries.active7' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.analytics.countries.active30' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.analytics.countries.paid' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (r of report().rows; track r.kind + (r.country ?? '')) {
                <tr [attr.data-country]="r.country ?? r.kind">
                  <th scope="row">
                    @switch (r.kind) {
                      @case ('other') {
                        {{
                          'admin.staff.analytics.countries.other'
                            | translate: { count: r.countries }
                        }}
                      }
                      @case ('unknown') {
                        {{
                          'admin.staff.analytics.countries.unknown' | translate
                        }}
                      }
                      @default {
                        {{ label(r) }}
                      }
                    }
                  </th>
                  <td class="num">{{ r.learners | locale: 'integer' }}</td>
                  <td class="num">{{ r.active7 | locale: 'integer' }}</td>
                  <td class="num">{{ r.active30 | locale: 'integer' }}</td>
                  <td class="num">{{ r.paid | locale: 'integer' }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  {{ 'admin.staff.analytics.countries.total' | translate }}
                </th>
                <td class="num">
                  {{ report().total.learners | locale: 'integer' }}
                </td>
                <td class="num">
                  {{ report().total.active7 | locale: 'integer' }}
                </td>
                <td class="num">
                  {{ report().total.active30 | locale: 'integer' }}
                </td>
                <td class="num">
                  {{ report().total.paid | locale: 'integer' }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      h2 {
        font-size: 1.125rem;
      }
      tfoot th,
      tfoot td {
        font-weight: 600;
      }
    `,
  ],
})
export class CountryReportCard {
  private readonly i18n = inject(I18nService);
  readonly report = input.required<CountryReport>();

  protected label(r: CountryReportRow): string {
    const name = countryName(r.country, this.i18n.currentLocale());
    return name && r.country && name !== r.country
      ? `${name} (${r.country})`
      : (r.country ?? '');
  }
}

/**
 * Monthly-PIX drop-off (docs/09 §4): BRL monthly checkouts that met "card
 * only" in the last 30 days → card checkout / switched to annual / left.
 */
@Component({
  selector: 'cdf-monthly-pix-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LocalePipe],
  template: `
    <section
      class="admin-card"
      aria-labelledby="monthly-pix"
      data-testid="monthly-pix"
    >
      <h2 id="monthly-pix">
        {{ 'admin.staff.analytics.monthlyPix.title' | translate }}
      </h2>
      <p class="muted small">
        {{
          'admin.staff.analytics.monthlyPix.help'
            | translate: { days: funnel().days }
        }}
      </p>
      @if (funnel().cardOnlySeen === 0) {
        <p class="muted small">
          {{
            'admin.staff.analytics.monthlyPix.empty'
              | translate: { days: funnel().days }
          }}
        </p>
      } @else {
        <div class="table-scroll">
          <table class="admin-table" data-testid="monthly-pix-table">
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.staff.analytics.monthlyPix.step' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.analytics.monthlyPix.visits' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.analytics.monthlyPix.share' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.key) {
                <tr>
                  <th scope="row" [class.sub]="r.sub">
                    {{ r.key | translate }}
                  </th>
                  <td class="num">{{ r.count | locale: 'integer' }}</td>
                  <td class="num">{{ pct(r.share) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      h2 {
        font-size: 1.125rem;
      }
      th.sub {
        font-weight: 400;
        padding-inline-start: var(--cdf-space-4);
      }
    `,
  ],
})
export class MonthlyPixCard {
  private readonly i18n = inject(I18nService);
  readonly funnel = input.required<MonthlyPixFunnel>();
  protected readonly rows = computed(() => pixFunnelRows(this.funnel()));

  protected pct(v: number | null): string {
    return v === null
      ? '—'
      : formatForLocale(v, this.i18n.currentLocale(), 'percent');
  }
}
