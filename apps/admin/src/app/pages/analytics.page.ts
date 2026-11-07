import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Button,
  DateRangePicker,
  type DateRange,
  type DateRangePreset,
  EmptyState,
  Skeleton,
} from '@codify/ui-bootstrap';
import { AnalyticsClient, type AnalyticsSummaryRow } from '@codify/api-client';
import { AdminErrors } from '../core/errors';

export interface AnalyticsPivot {
  days: string[];
  events: { name: string; perDay: Record<string, number>; total: number }[];
  dayTotals: Record<string, number>;
  total: number;
}

/** Rows (event × day) → event rows with one column per day, plus totals. */
export function pivotSummary(
  rows: readonly AnalyticsSummaryRow[],
): AnalyticsPivot {
  const days = [...new Set(rows.map((r) => r.day.slice(0, 10)))].sort();
  const byEvent = new Map<string, Record<string, number>>();
  const dayTotals: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const day = r.day.slice(0, 10);
    const perDay = byEvent.get(r.name) ?? {};
    perDay[day] = (perDay[day] ?? 0) + r.count;
    byEvent.set(r.name, perDay);
    dayTotals[day] = (dayTotals[day] ?? 0) + r.count;
    total += r.count;
  }
  const events = [...byEvent.entries()]
    .map(([name, perDay]) => ({
      name,
      perDay,
      total: Object.values(perDay).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { days, events, dayTotals, total };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Analytics (ADMIN, docs/10 §14): first-party event counts per event per
 * UTC day for a date range, with per-event and per-day totals.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    DateRangePicker,
    EmptyState,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.analytics.title' | translate }}</h1>
          <p class="muted">{{ 'admin.analytics.subtitle' | translate }}</p>
        </div>
      </header>

      <section class="admin-card range">
        <cdf-date-range-picker
          [legend]="'admin.analytics.range' | translate"
          [presets]="presets"
          [clearable]="false"
          [(ngModel)]="range"
        />
        <cdf-button
          kind="primary"
          [loading]="loading()"
          (click)="load()"
          data-testid="analytics-apply"
        >
          {{ 'admin.analytics.apply' | translate }}
        </cdf-button>
      </section>

      @if (pivot(); as p) {
        <div class="stat-grid">
          <div class="stat">
            <div class="stat__label">
              {{ 'admin.analytics.totalEvents' | translate }}
            </div>
            <div class="stat__value">{{ p.total | locale: 'number' }}</div>
          </div>
          <div class="stat">
            <div class="stat__label">
              {{ 'admin.analytics.distinctEvents' | translate }}
            </div>
            <div class="stat__value">
              {{ p.events.length | locale: 'number' }}
            </div>
          </div>
          <div class="stat">
            <div class="stat__label">
              {{ 'admin.analytics.days' | translate }}
            </div>
            <div class="stat__value">
              {{ p.days.length | locale: 'number' }}
            </div>
          </div>
        </div>

        @if (p.events.length === 0) {
          <cdf-empty-state
            icon="eye"
            [title]="'admin.analytics.emptyTitle' | translate"
            [description]="'admin.analytics.emptyDescription' | translate"
          />
        } @else {
          <section class="admin-card table-scroll">
            <table class="admin-table" data-testid="analytics-table">
              <caption class="visually-hidden">
                {{
                  'admin.analytics.caption' | translate
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ 'admin.analytics.event' | translate }}</th>
                  @for (d of p.days; track d) {
                    <th scope="col" class="num">
                      {{ dayDate(d) | locale: 'date' : 'short' }}
                    </th>
                  }
                  <th scope="col" class="num">
                    {{ 'admin.analytics.total' | translate }}
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (e of p.events; track e.name) {
                  <tr>
                    <th scope="row" class="mono">{{ e.name }}</th>
                    @for (d of p.days; track d) {
                      <td class="num">
                        {{
                          e.perDay[d] ? (e.perDay[d] | locale: 'number') : '·'
                        }}
                      </td>
                    }
                    <td class="num">
                      <strong>{{ e.total | locale: 'number' }}</strong>
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{{ 'admin.analytics.total' | translate }}</th>
                  @for (d of p.days; track d) {
                    <td class="num">
                      <strong>{{ p.dayTotals[d] | locale: 'number' }}</strong>
                    </td>
                  }
                  <td class="num">
                    <strong>{{ p.total | locale: 'number' }}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        }
      } @else if (loading()) {
        <cdf-skeleton shape="rect" height="200px" />
      }
    </div>
  `,
  styles: [
    `
      .range {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
      }
    `,
  ],
})
export class AnalyticsPage {
  private readonly analytics = inject(AnalyticsClient);
  private readonly errorsSvc = inject(AdminErrors);

  protected readonly presets: DateRangePreset[] = [
    {
      label: 'admin.analytics.presets.today',
      startOffsetDays: 0,
      endOffsetDays: 0,
    },
    {
      label: 'admin.analytics.presets.last7',
      startOffsetDays: -6,
      endOffsetDays: 0,
    },
    {
      label: 'admin.analytics.presets.last30',
      startOffsetDays: -29,
      endOffsetDays: 0,
    },
  ];
  protected range: DateRange = {
    start: isoDay(new Date(Date.now() - 6 * 86_400_000)),
    end: isoDay(new Date()),
  };
  protected readonly loading = signal(false);
  private readonly rows = signal<AnalyticsSummaryRow[] | null>(null);
  protected readonly pivot = computed(() => {
    const r = this.rows();
    return r ? pivotSummary(r) : null;
  });
  private seq = 0;

  constructor() {
    void this.load();
  }

  /** UTC midnight of a `YYYY-MM-DD` bucket, for locale formatting. */
  protected dayDate(day: string): string {
    return `${day}T00:00:00Z`;
  }

  protected async load(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const rows = await this.analytics.summary(
        this.range.start ?? undefined,
        this.range.end ?? undefined,
      );
      if (seq === this.seq) this.rows.set(rows);
    } catch (err) {
      if (seq === this.seq)
        this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}
