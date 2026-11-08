import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  type BadgeVariant,
  Button,
  EmptyState,
  ProgressBar,
  Skeleton,
} from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  AdminOpsClient,
  type AuditEntry,
  type CourseAnalyticsReport,
  type CourseEnrollmentRow,
  type CourseMultiplierRow,
  type CourseTranslationsReport,
  type TranslationFieldStatus,
} from '@codify/api-client';
import { LoadError } from '../core/load-error';

/** Shared async state for a tab: value, error, loading + retry. */
@Directive()
abstract class AsyncTab<T> {
  readonly courseId = input.required<string>();
  protected readonly data = signal<T | null>(null);
  protected readonly error = signal<unknown>(null);
  protected readonly loading = signal(true);
  private seq = 0;

  constructor() {
    effect(() => {
      const id = this.courseId();
      untracked(() => void this.reload(id));
    });
  }

  protected abstract fetch(courseId: string): Promise<T>;

  protected async reload(id = this.courseId()): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const v = await this.fetch(id);
      if (seq === this.seq) this.data.set(v);
    } catch (err) {
      if (seq === this.seq) this.error.set(err);
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}

const STATUS_VARIANT: Record<TranslationFieldStatus, BadgeVariant> = {
  done: 'success',
  outdated: 'warning',
  missing: 'danger',
};

/** STF-8: translation completeness for the course's own entities. */
@Component({
  selector: 'cdf-course-translations-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Badge, ProgressBar, Skeleton, LoadError, TranslatePipe],
  template: `
    @if (error(); as err) {
      <cdf-admin-load-error [error]="err" (retry)="reload()" />
    } @else if (data(); as r) {
      <header class="section-head">
        <h2>{{ 'admin.courseTabs.translations.title' | translate }}</h2>
        <a
          [routerLink]="['/translations']"
          [queryParams]="{ entityType: 'COURSE', q: slug() }"
          data-testid="open-workspace"
          >{{ 'admin.courseTabs.translations.openWorkspace' | translate }}</a
        >
      </header>
      <p class="muted small">
        {{
          'admin.courseTabs.translations.source'
            | translate: { locale: r.sourceLocale }
        }}
      </p>
      <div class="locale-grid">
        @for (l of r.locales; track l.locale) {
          <div class="locale-card">
            <strong>{{ l.locale }}</strong>
            <cdf-progress-bar
              [value]="l.pct"
              [label]="
                'admin.courseTabs.translations.pct' | translate: { pct: l.pct }
              "
            />
            <span class="small">{{
              'admin.courseTabs.translations.counts'
                | translate
                  : { done: l.done, outdated: l.outdated, missing: l.missing }
            }}</span>
          </div>
        } @empty {
          <p class="muted small">
            {{ 'admin.courseTabs.translations.noTargets' | translate }}
          </p>
        }
      </div>
      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">
                {{ 'admin.courseTabs.translations.entity' | translate }}
              </th>
              <th scope="col">
                {{ 'admin.courseTabs.translations.fields' | translate }}
              </th>
            </tr>
          </thead>
          <tbody>
            @for (e of r.entities; track e.entityId) {
              <tr>
                <td>
                  <span class="muted small">{{
                    'admin.courseTabs.translations.types.' + e.entityType
                      | translate
                  }}</span>
                  <div>{{ e.label }}</div>
                </td>
                <td class="chip-row">
                  @for (f of fieldList(e.fields); track f.key) {
                    <cdf-badge [variant]="variant(f.status)" [subtle]="true">
                      {{ f.field }} · {{ f.locale }}:
                      {{
                        'admin.courseTabs.translations.status.' + f.status
                          | translate
                      }}
                    </cdf-badge>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <cdf-skeleton shape="rect" height="160px" />
    }
  `,
  styles: [
    `
      /* Contain visually-hidden labels so they can't widen the page. */
      .table-scroll {
        position: relative;
      }
      .locale-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .locale-card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: var(--cdf-space-3);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
      }
    `,
  ],
})
export class CourseTranslationsTab extends AsyncTab<CourseTranslationsReport> {
  private readonly client = inject(AdminCatalogClient);
  /** Course slug — the workspace link filters on it. */
  readonly slug = input('');

  protected fetch(id: string) {
    return this.client.courseTranslations(id);
  }

  protected variant(s: TranslationFieldStatus): BadgeVariant {
    return STATUS_VARIANT[s];
  }

  protected fieldList(
    fields: Record<string, Record<string, TranslationFieldStatus>>,
  ): {
    key: string;
    field: string;
    locale: string;
    status: TranslationFieldStatus;
  }[] {
    return Object.entries(fields).flatMap(([field, byLocale]) =>
      Object.entries(byLocale).map(([locale, status]) => ({
        key: `${field}|${locale}`,
        field,
        locale,
        status,
      })),
    );
  }
}

/** STF-8: per-course funnel, lesson drop-off and conversions. */
@Component({
  selector: 'cdf-course-analytics-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, Skeleton, LoadError, TranslatePipe, LocalePipe],
  template: `
    @if (error(); as err) {
      <cdf-admin-load-error [error]="err" (retry)="reload()" />
    } @else if (data(); as r) {
      <h2>{{ 'admin.courseTabs.analytics.funnel' | translate }}</h2>
      <ol class="funnel" data-testid="course-funnel">
        @for (s of funnel(); track s.key) {
          <li>
            <span class="label">{{
              'admin.courseTabs.analytics.steps.' + s.key | translate
            }}</span>
            <span
              class="bar"
              [style.width.%]="s.width"
              aria-hidden="true"
            ></span>
            <strong>{{ s.value | locale: 'number' }}</strong>
          </li>
        }
      </ol>
      <p class="muted small">
        {{ 'admin.courseTabs.analytics.funnelHelp' | translate }}
      </p>

      <h2>{{ 'admin.courseTabs.analytics.lessons' | translate }}</h2>
      @if (r.lessons.length === 0) {
        <cdf-empty-state
          icon="file"
          [title]="'admin.courseTabs.analytics.noLessons' | translate"
        />
      } @else {
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.courseTabs.analytics.lesson' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.courseTabs.analytics.opened' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.courseTabs.analytics.completed' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.courseTabs.analytics.dropOff' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (l of r.lessons; track l.lessonId; let i = $index) {
                <tr>
                  <td>{{ i + 1 }}. {{ l.title }}</td>
                  <td class="num">{{ l.opened | locale: 'number' }}</td>
                  <td class="num">{{ l.completed | locale: 'number' }}</td>
                  <td class="num">
                    @if (l.dropOffPct === null) {
                      <span class="muted">—</span>
                    } @else {
                      <span class="heat" [style.--heat]="l.dropOffPct / 100"
                        >{{ l.dropOffPct }}%</span
                      >
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <h2>{{ 'admin.courseTabs.analytics.conversions' | translate }}</h2>
      @if (r.conversions.length === 0) {
        <p class="muted small">
          {{ 'admin.courseTabs.analytics.noEnrollments' | translate }}
        </p>
      } @else {
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">
                {{ 'admin.courseTabs.analytics.source' | translate }}
              </th>
              <th scope="col" class="num">
                {{ 'admin.courseTabs.analytics.enrolled' | translate }}
              </th>
              <th scope="col" class="num">
                {{ 'admin.courseTabs.analytics.converted' | translate }}
              </th>
            </tr>
          </thead>
          <tbody>
            @for (c of r.conversions; track c.source) {
              <tr>
                <td>
                  {{
                    'admin.courseTabs.enrollments.sources.' + c.source
                      | translate
                  }}
                </td>
                <td class="num">{{ c.enrolled | locale: 'number' }}</td>
                <td class="num">{{ c.convertedToPaid | locale: 'number' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
      <p class="muted small">
        {{
          'admin.courseTabs.analytics.generated'
            | translate: { at: (r.generatedAt | locale: 'datetime') }
        }}
      </p>
    } @else {
      <cdf-skeleton shape="rect" height="200px" />
    }
  `,
  styles: [
    `
      .funnel {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--cdf-space-2);
        display: flex;
        flex-direction: column;
        gap: 6px;
        li {
          display: grid;
          grid-template-columns: 120px 1fr 60px;
          align-items: center;
          gap: var(--cdf-space-2);
        }
        .bar {
          display: block;
          height: 14px;
          min-width: 2px;
          border-radius: 4px;
          background: var(--cdf-color-primary);
        }
        strong {
          text-align: end;
        }
      }
      .heat {
        display: inline-block;
        min-width: 44px;
        padding: 0 6px;
        border-radius: 4px;
        background: color-mix(
          in srgb,
          var(--cdf-color-danger) calc(var(--heat) * 60%),
          transparent
        );
      }
      h2 {
        margin-top: var(--cdf-space-4);
      }
    `,
  ],
})
export class CourseAnalyticsTab extends AsyncTab<CourseAnalyticsReport> {
  private readonly client = inject(AdminCatalogClient);

  protected fetch(id: string) {
    return this.client.courseAnalytics(id);
  }

  protected readonly funnel = computed(() => {
    const f = this.data()?.funnel;
    if (!f) return [];
    const top = Math.max(1, f.enrolled, f.started);
    return (['enrolled', 'started', 'half', 'completed'] as const).map(
      (key) => ({
        key,
        value: f[key],
        width: Math.round((f[key] / top) * 100),
      }),
    );
  });
}

/** STF-9: enrollments, pseudonymous for TEACHER (server-side). */
@Component({
  selector: 'cdf-course-enrollments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Button,
    EmptyState,
    Skeleton,
    LoadError,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    @if (error(); as err) {
      <cdf-admin-load-error [error]="err" (retry)="reload()" />
    } @else if (data(); as page) {
      <header class="section-head">
        <h2>{{ 'admin.courseTabs.enrollments.title' | translate }}</h2>
        <span class="muted small">{{
          'admin.courseTabs.enrollments.total'
            | translate: { count: page.total }
        }}</span>
      </header>
      @if (anonymised()) {
        <p class="muted small">
          {{ 'admin.courseTabs.enrollments.anonymised' | translate }}
        </p>
      }
      @if (page.items.length === 0) {
        <cdf-empty-state
          icon="user-circle"
          [title]="'admin.courseTabs.enrollments.emptyTitle' | translate"
          [description]="
            'admin.courseTabs.enrollments.emptyDescription' | translate
          "
        />
      } @else {
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.courseTabs.enrollments.learner' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.courseTabs.analytics.source' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.courseTabs.enrollments.enrolledAt' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.courseTabs.enrollments.completed' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.courseTabs.enrollments.lastActivity' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (e of page.items; track e.learner) {
                <tr>
                  <td>
                    @if (e.userId) {
                      <a [routerLink]="['/users', e.userId]">{{
                        e.displayName
                      }}</a>
                    } @else {
                      <span class="mono">{{ e.learner }}</span>
                    }
                  </td>
                  <td>
                    {{
                      'admin.courseTabs.enrollments.sources.' + e.source
                        | translate
                    }}
                  </td>
                  <td>{{ e.enrolledAt | locale: 'date' }}</td>
                  <td class="num">
                    {{ e.completedLessons | locale: 'number' }}
                  </td>
                  <td>
                    {{
                      e.lastCompletedAt
                        ? (e.lastCompletedAt | locale: 'date')
                        : '—'
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (page.items.length < page.total) {
          <cdf-button
            kind="secondary"
            size="sm"
            [loading]="loading()"
            (click)="more()"
          >
            {{ 'admin.courseTabs.enrollments.more' | translate }}
          </cdf-button>
        }
      }
    } @else {
      <cdf-skeleton shape="rect" height="160px" />
    }
  `,
})
export class CourseEnrollmentsTab extends AsyncTab<{
  items: CourseEnrollmentRow[];
  total: number;
}> {
  private readonly client = inject(AdminCatalogClient);
  protected readonly anonymised = computed(() => {
    const items = this.data()?.items ?? [];
    return items.length > 0 && items.every((e) => !e.userId);
  });

  protected fetch(id: string) {
    return this.client.courseEnrollments(id, { take: 50 });
  }

  protected async more(): Promise<void> {
    const cur = this.data();
    if (!cur) return;
    this.loading.set(true);
    try {
      const next = await this.client.courseEnrollments(this.courseId(), {
        skip: cur.items.length,
        take: 50,
      });
      this.data.set({
        items: [...cur.items, ...next.items],
        total: next.total,
      });
    } catch (err) {
      this.error.set(err);
    } finally {
      this.loading.set(false);
    }
  }
}

/** STF-8: the last 100 audit entries on this course. */
@Component({
  selector: 'cdf-course-audit-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyState,
    Skeleton,
    LoadError,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    @if (error(); as err) {
      <cdf-admin-load-error [error]="err" (retry)="reload()" />
    } @else if (data(); as rows) {
      <header class="section-head">
        <h2>{{ 'admin.courseTabs.audit.title' | translate }}</h2>
        <a [routerLink]="['/audit']" [queryParams]="{ entityId: courseId() }">{{
          'admin.courseTabs.audit.openLog' | translate
        }}</a>
      </header>
      @if (rows.length === 0) {
        <cdf-empty-state
          icon="file"
          [title]="'admin.courseTabs.audit.empty' | translate"
        />
      } @else {
        <ul class="plain-list audit-list">
          @for (a of rows; track a.id) {
            <li>
              <span class="mono">{{ a.action }}</span>
              <span>{{
                a.actorName ??
                  a.actorEmail ??
                  ('admin.courseTabs.audit.system' | translate)
              }}</span>
              <span class="muted small">{{
                a.createdAt | locale: 'datetime'
              }}</span>
            </li>
          }
        </ul>
      }
    } @else {
      <cdf-skeleton shape="rect" height="160px" />
    }
  `,
  styles: [
    `
      .audit-list li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
        gap: var(--cdf-space-2);
        padding: 6px 0;
        border-top: 1px solid var(--cdf-color-border);
      }
    `,
  ],
})
export class CourseAuditTab extends AsyncTab<AuditEntry[]> {
  private readonly ops = inject(AdminOpsClient);

  protected async fetch(id: string) {
    return (await this.ops.audit({ entityId: id, limit: 100 })).items;
  }
}

/** Course + lesson multipliers (STF-9: read-only for TEACHER). */
@Component({
  selector: 'cdf-course-multipliers-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Badge,
    EmptyState,
    Skeleton,
    LoadError,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    @if (error(); as err) {
      <cdf-admin-load-error [error]="err" (retry)="reload()" />
    } @else if (data(); as rows) {
      <header class="section-head">
        <h2>{{ 'admin.course.promotions' | translate }}</h2>
        @if (manage()) {
          <a
            [routerLink]="['/promotions']"
            [queryParams]="{ courseId: courseId() }"
            >{{ 'admin.course.managePromotions' | translate }}</a
          >
        } @else {
          <span class="muted small">{{
            'admin.courseTabs.promotions.readOnly' | translate
          }}</span>
        }
      </header>
      @if (rows.length === 0) {
        <cdf-empty-state
          icon="calendar"
          [title]="'admin.course.noPromotions' | translate"
        />
      } @else {
        <ul class="plain-list">
          @for (mu of rows; track mu.id) {
            <li class="chip-row promo-row">
              <cdf-badge
                [variant]="mu.activeNow ? 'success' : 'neutral'"
                [subtle]="true"
                >{{
                  (mu.activeNow
                    ? 'admin.promotions.activeNow'
                    : 'admin.promotions.scheduled'
                  ) | translate
                }}</cdf-badge
              >
              <strong>×{{ mu.value }}</strong>
              <span>{{ 'admin.promotions.kinds.' + mu.kind | translate }}</span>
              <span class="muted small">{{
                'admin.promotions.targets.' + mu.target | translate
              }}</span>
              @if (mu.lessonId) {
                <span class="muted small">{{
                  'admin.courseTabs.promotions.lessonLevel' | translate
                }}</span>
              }
              <span class="muted small"
                >{{ mu.startsAt ? (mu.startsAt | locale: 'datetime') : '…' }} →
                {{ mu.endsAt ? (mu.endsAt | locale: 'datetime') : '…' }}</span
              >
            </li>
          }
        </ul>
      }
    } @else {
      <cdf-skeleton shape="rect" height="120px" />
    }
  `,
  styles: [
    `
      .promo-row {
        padding: 6px 0;
        border-top: 1px solid var(--cdf-color-border);
      }
    `,
  ],
})
export class CourseMultipliersTab extends AsyncTab<CourseMultiplierRow[]> {
  private readonly client = inject(AdminCatalogClient);
  protected readonly i18n = inject(I18nService);
  /** ADMIN manages promotions; others see the list read-only. */
  readonly manage = input(false);

  protected fetch(id: string) {
    return this.client.courseMultipliers(id);
  }
}
