import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  I18nService,
  LocalePipe,
  TranslatePipe,
  formatForLocale,
} from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Button,
  DateRangePicker,
  type DateRange,
  type DateRangePreset,
  EmptyState,
  Skeleton,
} from '@codify/ui-bootstrap';
import {
  AnalyticsClient,
  ReportsClient,
  type AnalyticsSummaryRow,
  type CourseFunnel,
  type LessonFunnel,
  type OverviewReport,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../shared/load-error';
import { BarChart, type BarPoint } from '../shared/bar-chart';

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

/** Completion share of a funnel (0–1; 0 with nobody enrolled). */
export function completionRate(
  c: Pick<CourseFunnel, 'enrolled' | 'completed'>,
): number {
  return c.enrolled > 0 ? Math.min(1, c.completed / c.enrolled) : 0;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Tab = 'overview' | 'courses' | 'events';

/**
 * Analytics (docs/04 "Analytics", docs/09 §13, docs/10 §14):
 *  - Overview (ADMIN): billing KPIs (MRR, trial → paid, ARPPU, refund
 *    rate), MRR per plan, new vs churned subscriptions, retention by signup
 *    cohort (D1/D7/D30), league participation and shop revenue (coins).
 *  - Courses (ADMIN all, TEACHER own): enrolled → started → completed and
 *    per-lesson drop-off.
 *  - Events (ADMIN): first-party event counts per day.
 * Every chart has its data table.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    BarChart,
    Button,
    DateRangePicker,
    EmptyState,
    LoadError,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.analytics.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.staff.analytics.subtitle' | translate }}
          </p>
        </div>
      </header>

      <div class="tabs" role="tablist">
        @for (t of tabs(); track t) {
          <button
            type="button"
            role="tab"
            [id]="'atab-' + t"
            [attr.aria-selected]="tab() === t"
            [attr.aria-controls]="'apanel-' + t"
            [attr.data-testid]="'analytics-tab-' + t"
            (click)="openTab(t)"
          >
            {{ 'admin.staff.analytics.tabs.' + t | translate }}
          </button>
        }
      </div>

      @switch (tab()) {
        @case ('overview') {
          <section
            id="apanel-overview"
            role="tabpanel"
            aria-labelledby="atab-overview"
          >
            @if (overviewError(); as e) {
              <cdf-load-error [message]="e" (retry)="loadOverview(true)" />
            } @else if (overview(); as o) {
              <div class="toolbar">
                <span class="muted small">{{
                  'admin.dashboard.updated'
                    | translate: { time: (o.generatedAt | locale: 'datetime') }
                }}</span>
                <cdf-button
                  kind="ghost"
                  size="sm"
                  [loading]="loading()"
                  (click)="loadOverview(true)"
                  >{{ 'admin.common.refresh' | translate }}</cdf-button
                >
              </div>
              <section
                class="stat-grid"
                aria-labelledby="billing-kpis"
                data-testid="billing-kpis"
              >
                <h2 id="billing-kpis" class="visually-hidden">
                  {{ 'admin.staff.analytics.billingKpis' | translate }}
                </h2>
                <div class="stat">
                  <div class="stat__label">
                    {{ 'admin.dashboard.mrr' | translate }}
                  </div>
                  <div class="stat__value">
                    {{ o.billing.mrr.amountCents | locale: 'currency' : 'BRL' }}
                  </div>
                </div>
                <div class="stat">
                  <div class="stat__label">
                    {{ 'admin.staff.analytics.trialToPaid' | translate }}
                  </div>
                  <div class="stat__value">
                    {{ pct(o.billing.trialToPaid.rate) }}
                  </div>
                  <div class="muted small">
                    {{
                      'admin.staff.analytics.trialsEnded'
                        | translate
                          : {
                              converted: o.billing.trialToPaid.converted,
                              ended: o.billing.trialToPaid.trialsEnded,
                            }
                    }}
                  </div>
                </div>
                @for (a of o.billing.arppu; track a.currency) {
                  <div class="stat">
                    <div class="stat__label">
                      {{
                        'admin.staff.analytics.arppu'
                          | translate: { currency: a.currency }
                      }}
                    </div>
                    <div class="stat__value">
                      {{ a.arppuCents | locale: 'currency' : a.currency }}
                    </div>
                    <div class="muted small">
                      {{
                        'admin.staff.analytics.payingUsers'
                          | translate: { count: a.payingUsers }
                      }}
                    </div>
                  </div>
                }
                @for (r of o.billing.refunds; track r.currency) {
                  <div class="stat">
                    <div class="stat__label">
                      {{
                        'admin.staff.analytics.refundRate'
                          | translate: { currency: r.currency }
                      }}
                    </div>
                    <div class="stat__value">{{ pct(r.rate) }}</div>
                    <div class="muted small">
                      {{
                        'admin.staff.analytics.refundedPayments'
                          | translate
                            : { count: r.refundedPayments, total: r.payments }
                      }}
                    </div>
                  </div>
                }
              </section>

              <div class="grid-2">
                <section class="admin-card" aria-labelledby="mrr-plan">
                  <h2 id="mrr-plan">
                    {{ 'admin.staff.analytics.mrrByPlan' | translate }}
                  </h2>
                  @if (o.billing.mrr.byPlan.length === 0) {
                    <p class="muted small">
                      {{ 'admin.staff.analytics.noSubscriptions' | translate }}
                    </p>
                  } @else {
                    <div class="table-scroll">
                      <table class="admin-table" data-testid="mrr-by-plan">
                        <thead>
                          <tr>
                            <th scope="col">
                              {{ 'admin.staff.analytics.plan' | translate }}
                            </th>
                            <th scope="col" class="num">
                              {{
                                'admin.staff.analytics.subscriptions'
                                  | translate
                              }}
                            </th>
                            <th scope="col" class="num">
                              {{ 'admin.dashboard.mrr' | translate }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (p of o.billing.mrr.byPlan; track p.planId) {
                            <tr>
                              <th scope="row">{{ p.planName }}</th>
                              <td class="num">
                                {{ p.subscriptions | locale: 'integer' }}
                                @if (p.excluded > 0) {
                                  <div class="muted small">
                                    {{
                                      'admin.dashboard.mrrExcluded'
                                        | translate: { count: p.excluded }
                                    }}
                                  </div>
                                }
                              </td>
                              <td class="num">
                                {{ p.amountCents | locale: 'currency' : 'BRL' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </section>

                <section class="admin-card" aria-labelledby="subs-weeks">
                  <h2 id="subs-weeks">
                    {{ 'admin.staff.analytics.subsPerWeek' | translate }}
                  </h2>
                  <cdf-bar-chart
                    [title]="'admin.staff.analytics.newPaid' | translate"
                    [withTable]="false"
                    [points]="newPaidPoints()"
                    [labelHeader]="'admin.staff.analytics.week' | translate"
                    [valueHeader]="'admin.staff.analytics.newPaid' | translate"
                  />
                  <div class="table-scroll">
                    <table class="admin-table" data-testid="subs-weeks">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.staff.analytics.week' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.newPaid' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.churned' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.netNew' | translate }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (w of o.billing.weeks; track w.weekStart) {
                          <tr>
                            <th scope="row">
                              {{ w.weekStart | locale: 'date' : 'short' }}
                            </th>
                            <td class="num">
                              {{ w.newPaid | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ w.churned | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ w.netNew | locale: 'integer' }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <section class="admin-card" aria-labelledby="retention">
                <h2 id="retention">
                  {{ 'admin.staff.analytics.retention' | translate }}
                </h2>
                <p class="muted small">
                  {{ 'admin.staff.analytics.retentionHelp' | translate }}
                </p>
                @if (o.retention.length === 0) {
                  <p class="muted small">
                    {{ 'admin.staff.analytics.noCohorts' | translate }}
                  </p>
                } @else {
                  <div class="table-scroll">
                    <table class="admin-table" data-testid="retention-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.staff.analytics.cohort' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.signups' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.retentionD1' | translate
                            }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.retentionD7' | translate
                            }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.retentionD30' | translate
                            }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (c of o.retention; track c.cohortStart) {
                          <tr>
                            <th scope="row">
                              {{ c.cohortStart | locale: 'date' : 'short' }}
                            </th>
                            <td class="num">
                              {{ c.size | locale: 'integer' }}
                            </td>
                            <td class="num" [style.background]="tint(c.d1)">
                              {{ pct(c.d1) }}
                            </td>
                            <td class="num" [style.background]="tint(c.d7)">
                              {{ pct(c.d7) }}
                            </td>
                            <td class="num" [style.background]="tint(c.d30)">
                              {{ pct(c.d30) }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </section>

              <div class="grid-2">
                <section class="admin-card" aria-labelledby="leagues-part">
                  <h2 id="leagues-part">
                    {{
                      'admin.staff.analytics.leagueParticipation' | translate
                    }}
                  </h2>
                  <cdf-bar-chart
                    [title]="'admin.staff.analytics.participation' | translate"
                    [withTable]="false"
                    [points]="participationPoints()"
                    [labelHeader]="'admin.staff.analytics.week' | translate"
                    [valueHeader]="
                      'admin.staff.analytics.participation' | translate
                    "
                  />
                  <div class="table-scroll">
                    <table class="admin-table" data-testid="league-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.staff.analytics.week' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.activeMembers' | translate
                            }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.activeStudents' | translate
                            }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.promotedDemoted'
                                | translate
                            }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (w of o.leagues; track w.weekStart) {
                          <tr>
                            <th scope="row">
                              {{ w.weekStart | locale: 'date' : 'short' }}
                            </th>
                            <td class="num">
                              {{ w.activeMembers | locale: 'integer' }} /
                              {{ w.members | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ w.activeStudents | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ w.promoted }} / {{ w.demoted }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>

                <section class="admin-card" aria-labelledby="shop-rev">
                  <h2 id="shop-rev">
                    {{ 'admin.staff.analytics.shopRevenue' | translate }}
                  </h2>
                  <cdf-bar-chart
                    [title]="'admin.staff.analytics.coinsSpent' | translate"
                    [withTable]="false"
                    [points]="shopPoints()"
                    [labelHeader]="'admin.staff.analytics.week' | translate"
                    [valueHeader]="
                      'admin.staff.analytics.coinsSpent' | translate
                    "
                  />
                  <div class="table-scroll">
                    <table class="admin-table" data-testid="shop-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {{ 'admin.staff.analytics.week' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.coinsSpent' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.purchases' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.buyers' | translate }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (w of o.shop; track w.weekStart) {
                          <tr>
                            <th scope="row">
                              {{ w.weekStart | locale: 'date' : 'short' }}
                            </th>
                            <td class="num">
                              {{ w.coinsSpent | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ w.purchases | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ w.buyers | locale: 'integer' }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            } @else {
              <cdf-skeleton shape="rect" height="320px" />
            }
          </section>
        }
        @case ('courses') {
          <section
            id="apanel-courses"
            role="tabpanel"
            aria-labelledby="atab-courses"
          >
            @if (coursesError(); as e) {
              <cdf-load-error [message]="e" (retry)="loadCourses()" />
            } @else if (courses() === null) {
              <cdf-skeleton shape="rect" height="200px" />
            } @else if (courses()!.length === 0) {
              <cdf-empty-state
                icon="pencil"
                [title]="'admin.staff.analytics.noCourses' | translate"
                [description]="
                  'admin.staff.analytics.noCoursesBody' | translate
                "
              />
            } @else {
              <section class="admin-card table-scroll">
                <table class="admin-table" data-testid="course-funnels">
                  <caption class="visually-hidden">
                    {{
                      'admin.staff.analytics.funnelCaption' | translate
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        {{ 'admin.staff.analytics.course' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.staff.analytics.enrolled' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.staff.analytics.started' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.staff.analytics.completed' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.staff.analytics.completionRate' | translate }}
                      </th>
                      <th scope="col">
                        <span class="visually-hidden">{{
                          'admin.common.actions' | translate
                        }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of courses(); track c.courseId) {
                      <tr>
                        <th scope="row">
                          {{ c.title }}
                          <div class="muted small mono">{{ c.slug }}</div>
                        </th>
                        <td class="num">
                          {{ c.enrolled | locale: 'integer' }}
                        </td>
                        <td class="num">{{ c.started | locale: 'integer' }}</td>
                        <td class="num">
                          {{ c.completed | locale: 'integer' }}
                        </td>
                        <td class="num">{{ rate(c) | locale: 'percent' }}</td>
                        <td>
                          <cdf-button
                            kind="secondary"
                            size="sm"
                            [attr.data-course]="c.courseId"
                            (click)="openCourse(c)"
                            >{{
                              'admin.staff.analytics.dropOff' | translate
                            }}</cdf-button
                          >
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </section>
              @if (detail(); as d) {
                <section
                  class="admin-card"
                  aria-labelledby="lesson-funnel"
                  data-testid="lesson-funnel"
                >
                  <h2 id="lesson-funnel">
                    {{
                      'admin.staff.analytics.dropOffFor'
                        | translate: { course: d.course.title }
                    }}
                  </h2>
                  <cdf-bar-chart
                    [withTable]="false"
                    [title]="
                      'admin.staff.analytics.completionsPerLesson' | translate
                    "
                    [points]="lessonPoints()"
                    [labelHeader]="'admin.staff.analytics.lesson' | translate"
                    [valueHeader]="
                      'admin.staff.analytics.completed' | translate
                    "
                  />
                  <div class="table-scroll">
                    <table class="admin-table">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">
                            {{ 'admin.staff.analytics.lesson' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.opened' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{ 'admin.staff.analytics.completed' | translate }}
                          </th>
                          <th scope="col" class="num">
                            {{
                              'admin.staff.analytics.dropOffRate' | translate
                            }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (l of d.lessons; track l.lessonId) {
                          <tr>
                            <td>{{ l.position }}</td>
                            <th scope="row">{{ l.title }}</th>
                            <td class="num">
                              {{ l.opened | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ l.completed | locale: 'integer' }}
                            </td>
                            <td class="num">
                              {{ pct(l.dropOffRate) }}
                              @if (l.dropOff > 0) {
                                <span class="muted small"
                                  >(−{{ l.dropOff }})</span
                                >
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              }
            }
          </section>
        }
        @case ('events') {
          <section
            id="apanel-events"
            role="tabpanel"
            aria-labelledby="atab-events"
          >
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
                (click)="loadEvents()"
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
                  <div class="stat__value">
                    {{ p.total | locale: 'number' }}
                  </div>
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
                        <th scope="col">
                          {{ 'admin.analytics.event' | translate }}
                        </th>
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
                                e.perDay[d]
                                  ? (e.perDay[d] | locale: 'number')
                                  : '·'
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
                        <th scope="row">
                          {{ 'admin.analytics.total' | translate }}
                        </th>
                        @for (d of p.days; track d) {
                          <td class="num">
                            <strong>{{
                              p.dayTotals[d] | locale: 'number'
                            }}</strong>
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
          </section>
        }
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
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .grid-2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--cdf-space-3);
      }
      .grid-2 > * {
        min-width: 0;
      }
      h2 {
        font-size: 1.125rem;
      }
    `,
  ],
})
export class AnalyticsPage {
  private readonly analytics = inject(AnalyticsClient);
  private readonly reports = inject(ReportsClient);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);

  /** TEACHER sees only their own course funnels (docs/04 §1). */
  protected readonly tabs = computed<Tab[]>(() =>
    this.auth.role() === 'ADMIN'
      ? ['overview', 'courses', 'events']
      : ['courses'],
  );
  protected readonly tab = signal<Tab>('overview');
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
  protected readonly overview = signal<OverviewReport | null>(null);
  protected readonly overviewError = signal<string | null>(null);
  protected readonly courses = signal<CourseFunnel[] | null>(null);
  protected readonly coursesError = signal<string | null>(null);
  protected readonly detail = signal<{
    course: CourseFunnel;
    lessons: LessonFunnel[];
  } | null>(null);
  private readonly loaded = new Set<Tab>();
  private seq = 0;

  protected readonly newPaidPoints = computed<BarPoint[]>(() =>
    (this.overview()?.billing.weeks ?? []).map((w) => ({
      label: this.week(w.weekStart),
      value: w.newPaid,
      display: this.num(w.newPaid),
    })),
  );
  protected readonly participationPoints = computed<BarPoint[]>(() =>
    (this.overview()?.leagues ?? []).map((w) => ({
      label: this.week(w.weekStart),
      value: w.participation ?? 0,
      display: this.pct(w.participation),
    })),
  );
  protected readonly shopPoints = computed<BarPoint[]>(() =>
    (this.overview()?.shop ?? []).map((w) => ({
      label: this.week(w.weekStart),
      value: w.coinsSpent,
      display: this.num(w.coinsSpent),
    })),
  );
  protected readonly lessonPoints = computed<BarPoint[]>(() =>
    (this.detail()?.lessons ?? []).map((l) => ({
      label: `#${l.position} ${l.title}`,
      value: l.completed,
      display: this.num(l.completed),
    })),
  );

  constructor() {
    void this.auth.whenReady().then(() => this.openTab(this.tabs()[0]));
  }

  protected openTab(t: Tab): void {
    this.tab.set(t);
    if (this.loaded.has(t)) return;
    this.loaded.add(t);
    if (t === 'overview') void this.loadOverview(false);
    else if (t === 'courses') void this.loadCourses();
    else void this.loadEvents();
  }

  /** UTC midnight of a `YYYY-MM-DD` bucket, for locale formatting. */
  protected dayDate(day: string): string {
    return `${day}T00:00:00Z`;
  }

  protected rate(c: CourseFunnel): number {
    return completionRate(c);
  }

  protected pct(v: number | null): string {
    return v === null
      ? '—'
      : formatForLocale(v, this.i18n.currentLocale(), 'percent');
  }

  /** Sequential tint (one hue) for the retention cells; text stays ink. */
  protected tint(v: number | null): string | null {
    if (v === null) return null;
    const a = Math.round(Math.min(1, Math.max(0, v)) * 40) + 4;
    return `rgba(var(--cdf-color-primary-rgb), ${a / 100})`;
  }

  private week(iso: string): string {
    return formatForLocale(iso, this.i18n.currentLocale(), 'date', 'short');
  }

  private num(n: number): string {
    return formatForLocale(n, this.i18n.currentLocale(), 'integer');
  }

  protected async loadOverview(fresh: boolean): Promise<void> {
    this.overviewError.set(null);
    this.loading.set(true);
    try {
      this.overview.set(await this.reports.overview(fresh));
    } catch (err) {
      this.overviewError.set(
        this.errorsSvc.message(err, 'admin.errors.loadFailed'),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadCourses(): Promise<void> {
    this.coursesError.set(null);
    try {
      this.courses.set((await this.reports.courses()).items);
    } catch (err) {
      this.coursesError.set(
        this.errorsSvc.message(err, 'admin.errors.loadFailed'),
      );
    }
  }

  protected async openCourse(c: CourseFunnel): Promise<void> {
    try {
      this.detail.set(await this.reports.course(c.courseId));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async loadEvents(): Promise<void> {
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
