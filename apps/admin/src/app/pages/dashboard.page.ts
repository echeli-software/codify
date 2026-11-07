import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Badge,
  Button,
  Icon,
  ProgressBar,
  Skeleton,
} from '@codify/ui-bootstrap';
import { AdminOpsClient, type AdminDashboard } from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { canAccess } from '../core/roles';
import { LoadError } from '../shared/load-error';

/**
 * Dashboard (docs/04 "Dashboard"). ADMIN/SUPPORT: WAU, MAU, paid
 * conversions this week, active subscriptions, MRR (BRL), top courses by
 * completion. TEACHER: own enrollments today, lessons by drop-off, pending
 * translations. Everyone: the last 20 audit actions (teachers: their own).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Badge,
    Button,
    Icon,
    LoadError,
    ProgressBar,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.dashboard.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.dashboard.subtitle' | translate: { name: name() } }}
          </p>
        </div>
        <div class="page-head__actions">
          @if (data(); as d) {
            <span class="muted small">{{
              'admin.dashboard.updated'
                | translate: { time: (d.generatedAt | locale: 'time') }
            }}</span>
          }
          <cdf-button
            kind="ghost"
            size="sm"
            [loading]="loading()"
            (click)="load()"
          >
            <cdf-icon name="arrow-clockwise" size="sm" />
            {{ 'admin.common.refresh' | translate }}
          </cdf-button>
        </div>
      </header>

      @if (error(); as e) {
        <cdf-load-error [message]="e" (retry)="load()" />
      } @else if (!data()) {
        <section class="stat-grid" [attr.aria-busy]="true">
          @for (i of skeletons; track i) {
            <div class="stat">
              <cdf-skeleton shape="text" width="60%" />
              <cdf-skeleton shape="rect" height="32px" />
            </div>
          }
        </section>
        <cdf-skeleton shape="rect" height="220px" />
      } @else {
        @if (data()!.admin; as a) {
          <section
            class="stat-grid"
            aria-labelledby="kpi-title"
            data-testid="admin-kpis"
          >
            <h2 id="kpi-title" class="visually-hidden">
              {{ 'admin.dashboard.kpis' | translate }}
            </h2>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.wau' | translate }}
              </div>
              <div class="stat__value">{{ a.wau | locale: 'integer' }}</div>
            </div>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.mau' | translate }}
              </div>
              <div class="stat__value">{{ a.mau | locale: 'integer' }}</div>
            </div>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.conversions' | translate }}
              </div>
              <div class="stat__value">
                {{ a.paidConversionsThisWeek | locale: 'integer' }}
              </div>
            </div>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.activeSubs' | translate }}
              </div>
              <div class="stat__value">
                {{ a.activeSubscriptions | locale: 'integer' }}
              </div>
              @if (a.trialingSubscriptions > 0) {
                <div class="muted small">
                  {{
                    'admin.dashboard.trialing'
                      | translate: { count: a.trialingSubscriptions }
                  }}
                </div>
              }
            </div>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.mrr' | translate }}
              </div>
              <div class="stat__value">
                {{ a.mrr.amountCents | locale: 'currency' : 'BRL' }}
              </div>
              @if (a.mrr.excludedSubscriptions > 0) {
                <div class="muted small">
                  {{
                    'admin.dashboard.mrrExcluded'
                      | translate: { count: a.mrr.excludedSubscriptions }
                  }}
                </div>
              }
            </div>
          </section>

          <section class="admin-card" aria-labelledby="top-courses-title">
            <h2 id="top-courses-title">
              {{ 'admin.dashboard.topCourses' | translate }}
            </h2>
            @if (a.topCourses.length === 0) {
              <p class="muted small">
                {{ 'admin.dashboard.noCourses' | translate }}
              </p>
            } @else {
              <ol class="plain-list ranked">
                @for (c of a.topCourses; track c.courseId) {
                  <li>
                    <a [routerLink]="['/courses', c.slug]">{{ c.title }}</a>
                    <cdf-progress-bar
                      [value]="c.completionRate * 100"
                      [label]="
                        'admin.dashboard.completionOf'
                          | translate: { title: c.title }
                      "
                    />
                    <span class="small muted nowrap">{{
                      'admin.dashboard.completed'
                        | translate
                          : { completed: c.completed, enrolled: c.enrolled }
                    }}</span>
                  </li>
                }
              </ol>
            }
          </section>
        }

        @if (data()!.teacher; as t) {
          <section
            class="stat-grid"
            aria-labelledby="tkpi-title"
            data-testid="teacher-kpis"
          >
            <h2 id="tkpi-title" class="visually-hidden">
              {{ 'admin.dashboard.kpis' | translate }}
            </h2>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.enrollmentsToday' | translate }}
              </div>
              <div class="stat__value">
                {{ t.enrollmentsToday | locale: 'integer' }}
              </div>
            </div>
            <div class="stat">
              <div class="stat__label">
                {{ 'admin.dashboard.pendingTranslations' | translate }}
              </div>
              <div class="stat__value">
                {{ t.pendingTranslations | locale: 'integer' }}
              </div>
              @if (t.pendingTranslations > 0) {
                <a class="small" routerLink="/translations">{{
                  'admin.dashboard.openTranslations' | translate
                }}</a>
              }
            </div>
          </section>

          <div class="split">
            <section class="admin-card" aria-labelledby="dropoff-title">
              <h2 id="dropoff-title">
                {{ 'admin.dashboard.dropOff' | translate }}
              </h2>
              <p class="muted small">
                {{ 'admin.dashboard.dropOffHelp' | translate }}
              </p>
              @if (t.topDropOffLessons.length === 0) {
                <p class="muted small">
                  {{ 'admin.dashboard.noDropOff' | translate }}
                </p>
              } @else {
                <div class="table-scroll">
                  <table class="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          {{ 'admin.dashboard.lesson' | translate }}
                        </th>
                        <th scope="col" class="num">
                          {{ 'admin.dashboard.started' | translate }}
                        </th>
                        <th scope="col" class="num">
                          {{ 'admin.dashboard.finished' | translate }}
                        </th>
                        <th scope="col" class="num">
                          {{ 'admin.dashboard.dropRate' | translate }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (l of t.topDropOffLessons; track l.lessonId) {
                        <tr>
                          <td>
                            <a [routerLink]="['/lessons', l.lessonId]">{{
                              l.title
                            }}</a>
                            <div class="mono muted">{{ l.courseSlug }}</div>
                          </td>
                          <td class="num">
                            {{ l.started | locale: 'integer' }}
                          </td>
                          <td class="num">
                            {{ l.completed | locale: 'integer' }}
                          </td>
                          <td class="num">
                            {{ l.dropOffRate | locale: 'percent' }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>
            <section class="admin-card" aria-labelledby="enr-today-title">
              <h2 id="enr-today-title">
                {{ 'admin.dashboard.enrollmentsByCourse' | translate }}
              </h2>
              @if (t.enrollmentsTodayByCourse.length === 0) {
                <p class="muted small">
                  {{ 'admin.dashboard.noEnrollmentsToday' | translate }}
                </p>
              } @else {
                <ul class="plain-list">
                  @for (c of t.enrollmentsTodayByCourse; track c.courseId) {
                    <li class="kv-row">
                      <span>{{ c.title }}</span>
                      <strong>{{ c.count | locale: 'integer' }}</strong>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }

        <section class="admin-card" aria-labelledby="activity-title">
          <header class="section-head">
            <h2 id="activity-title">
              {{ 'admin.dashboard.activity' | translate }}
            </h2>
            @if (canAudit()) {
              <a routerLink="/audit" class="small">{{
                'admin.dashboard.viewAudit' | translate
              }}</a>
            }
          </header>
          @if (data()!.recentActivity.length === 0) {
            <p class="muted small">
              {{ 'admin.dashboard.noActivity' | translate }}
            </p>
          } @else {
            <ul class="plain-list activity" data-testid="recent-activity">
              @for (e of data()!.recentActivity; track e.id) {
                <li>
                  <cdf-badge variant="neutral" [subtle]="true">
                    <span class="mono">{{ e.action }}</span>
                  </cdf-badge>
                  <span class="activity__who">
                    {{ e.actorName ?? ('admin.audit.system' | translate) }}
                    @if (e.entity) {
                      <span class="muted small"
                        >· {{ e.entity }}
                        <span class="mono">{{ e.entityId }}</span></span
                      >
                    }
                  </span>
                  <time
                    class="muted small nowrap"
                    [attr.datetime]="e.createdAt"
                    >{{ e.createdAt | locale: 'relative' }}</time
                  >
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .ranked li {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(80px, 1fr) auto;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: 8px;
      }
      .nowrap {
        white-space: nowrap;
      }
      .kv-row {
        display: flex;
        justify-content: space-between;
        gap: var(--cdf-space-2);
        padding: 4px 0;
      }
      .activity li {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--cdf-space-2);
        padding: 6px 0;
        border-bottom: 1px solid var(--cdf-color-border);
      }
      .activity__who {
        flex: 1 1 200px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly client = inject(AdminOpsClient);
  private readonly errors = inject(AdminErrors);

  protected readonly skeletons = [1, 2, 3, 4, 5];
  protected readonly name = computed(() => this.auth.user()?.displayName ?? '');
  protected readonly canAudit = computed(() =>
    canAccess('audit', this.auth.role()),
  );
  protected readonly data = signal<AdminDashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.client.dashboard());
    } catch (err) {
      this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
