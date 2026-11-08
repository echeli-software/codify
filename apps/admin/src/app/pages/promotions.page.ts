import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  Button,
  type ComboboxOption,
  ConfirmDialogService,
  DateRangePicker,
  type DateRange,
  Drawer,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  MULTIPLIER_KINDS,
  MultiplierEditor,
  type MultiplierDraft,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  CoursesClient,
  GamificationClient,
  type CreateMultiplierBody,
  type Multiplier,
  type MultiplierKind,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { isoToLocal, localToIso } from '../core/catalog';
import { LoadError } from '../core/load-error';
import type { HasUnsavedChanges } from '../core/unsaved-changes';
import {
  calendarDays,
  matchesWindow,
  onDay,
  shiftAnchor,
  type CalendarMode,
  type WindowFilter,
} from '../core/promo-calendar';
import { MultiplierPreviewPanel } from './multiplier-preview.component';

/** Kinds the calendar shows (docs/04: CAMPAIGN and COURSE_PROMO windows). */
const CALENDAR_KINDS: readonly MultiplierKind[] = ['CAMPAIGN', 'COURSE_PROMO'];
const WINDOW_FILTERS: readonly WindowFilter[] = [
  'all',
  'active',
  'upcoming',
  'ended',
  'range',
];

/** Split multipliers into running-now / upcoming / other (ended or disabled). */
export function bucketPromotions(
  rows: readonly Multiplier[],
  now: Date,
): { active: Multiplier[]; upcoming: Multiplier[] } {
  const t = now.getTime();
  const active = rows.filter((m) => m.activeNow);
  const upcoming = rows
    .filter(
      (m) =>
        m.isActive &&
        !m.activeNow &&
        m.startsAt &&
        new Date(m.startsAt).getTime() > t,
    )
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
  return { active, upcoming };
}

export function toDraft(m: Multiplier): MultiplierDraft {
  return {
    kind: m.kind as MultiplierDraft['kind'],
    target: m.target,
    value: m.value,
    startsAt: isoToLocal(m.startsAt),
    endsAt: isoToLocal(m.endsAt),
    courseId: m.courseId,
    lessonId: m.lessonId,
    streakDaysMin: m.streakDaysMin,
    description: m.description,
    isActive: m.isActive,
  };
}

export function toBody(d: MultiplierDraft): CreateMultiplierBody {
  return {
    kind: d.kind,
    target: d.target,
    value: Number(d.value),
    startsAt: localToIso(d.startsAt),
    endsAt: localToIso(d.endsAt),
    courseId: d.courseId || null,
    lessonId: d.lessonId || null,
    streakDaysMin: d.kind === 'STREAK_TIER' ? d.streakDaysMin : null,
    description: d.description?.trim() || null,
    isActive: d.isActive,
  };
}

/**
 * Catalog → Promotions (docs/04, docs/07 §3): every multiplier with
 * create / edit / delete through the `MultiplierEditor` organism (kind,
 * target, value, schedule window, course / lesson scope), a "running now"
 * and "upcoming" view, and a quick "activate for 24 h" action.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    Badge,
    Button,
    DateRangePicker,
    Drawer,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    LoadError,
    MultiplierEditor,
    MultiplierPreviewPanel,
    Select,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.promotions.title' | translate }}</h1>
          <p class="muted">{{ 'admin.promotions.subtitle' | translate }}</p>
        </div>
        <cdf-button
          kind="primary"
          (click)="openEditor(null)"
          data-testid="new-multiplier"
        >
          <cdf-icon name="plus" size="sm" />
          {{ 'admin.promotions.new' | translate }}
        </cdf-button>
      </header>

      @if (loadError(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="refresh()" />
      } @else if (rows() === null) {
        <cdf-skeleton shape="rect" height="200px" />
      } @else {
        <div class="promo-grid">
          <section class="admin-card" aria-labelledby="promo-now">
            <h2 id="promo-now">
              {{ 'admin.promotions.activeNow' | translate }}
            </h2>
            @for (m of buckets().active; track m.id) {
              <ng-container
                *ngTemplateOutlet="promo; context: { $implicit: m }"
              />
            } @empty {
              <p class="muted small">
                {{ 'admin.promotions.noneActive' | translate }}
              </p>
            }
          </section>
          <section class="admin-card" aria-labelledby="promo-next">
            <h2 id="promo-next">
              {{ 'admin.promotions.upcoming' | translate }}
            </h2>
            @for (m of buckets().upcoming; track m.id) {
              <ng-container
                *ngTemplateOutlet="promo; context: { $implicit: m }"
              />
            } @empty {
              <p class="muted small">
                {{ 'admin.promotions.noneUpcoming' | translate }}
              </p>
            }
          </section>
        </div>

        <section class="admin-card">
          <header class="section-head">
            <h2>{{ 'admin.promotions.all' | translate }}</h2>
            <div
              class="view-toggle"
              role="radiogroup"
              [attr.aria-label]="'admin.promotions.view' | translate"
            >
              @for (v of views; track v) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="view() === v"
                  [class.active]="view() === v"
                  (click)="view.set(v)"
                  [attr.data-testid]="'promo-view-' + v"
                >
                  {{ 'admin.promotions.views.' + v | translate }}
                </button>
              }
            </div>
          </header>
          <div class="filters">
            <cdf-form-field
              [label]="'admin.promotions.kind' | translate"
              controlId="promo-kind-filter"
            >
              <cdf-select
                inputId="promo-kind-filter"
                [options]="kindFilterOptions()"
                [ngModel]="kindFilter()"
                (ngModelChange)="kindFilter.set($event ?? '')"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.promotions.windowFilter' | translate"
              controlId="promo-window-filter"
            >
              <cdf-select
                inputId="promo-window-filter"
                [options]="windowFilterOptions()"
                [ngModel]="windowFilter()"
                (ngModelChange)="windowFilter.set($event ?? 'all')"
                data-testid="promo-window-filter"
              />
            </cdf-form-field>
            @if (windowFilter() === 'range') {
              <cdf-date-range-picker
                [withTime]="false"
                [legend]="'admin.promotions.range' | translate"
                [ngModel]="range()"
                (ngModelChange)="
                  range.set($event ?? { start: null, end: null })
                "
              />
            }
          </div>
          @if (view() === 'calendar') {
            <div class="cal-head">
              <div class="row-actions">
                <cdf-button
                  kind="ghost"
                  size="sm"
                  (click)="shift(-1)"
                  [attr.aria-label]="
                    'admin.promotions.calendar.prev' | translate
                  "
                  >‹</cdf-button
                >
                <strong>{{ calendarTitle() }}</strong>
                <cdf-button
                  kind="ghost"
                  size="sm"
                  (click)="shift(1)"
                  [attr.aria-label]="
                    'admin.promotions.calendar.next' | translate
                  "
                  >›</cdf-button
                >
                <cdf-button
                  kind="ghost"
                  size="sm"
                  (click)="anchor.set(today())"
                  >{{
                    'admin.promotions.calendar.today' | translate
                  }}</cdf-button
                >
              </div>
              <div
                class="view-toggle"
                role="radiogroup"
                [attr.aria-label]="'admin.promotions.calendar.mode' | translate"
              >
                @for (m of calModes; track m) {
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="calMode() === m"
                    [class.active]="calMode() === m"
                    (click)="calMode.set(m)"
                  >
                    {{ 'admin.promotions.calendar.' + m | translate }}
                  </button>
                }
              </div>
            </div>
            <p class="muted small">
              {{ 'admin.promotions.calendar.help' | translate }}
            </p>
            <div
              class="calendar"
              [class.calendar--week]="calMode() === 'week'"
              role="grid"
              data-testid="promo-calendar"
            >
              <div class="cal-row" role="row">
                @for (w of weekdays(); track $index) {
                  <span class="cal-dow" role="columnheader">{{ w }}</span>
                }
              </div>
              @for (week of calendarWeeks(); track $index) {
                <div class="cal-row" role="row">
                  @for (day of week; track day.key) {
                    <div
                      class="cal-day"
                      role="gridcell"
                      [class.out]="day.outside"
                      [class.today]="day.today"
                      [attr.aria-label]="day.label"
                    >
                      <span class="cal-date">{{ day.date.getDate() }}</span>
                      @for (m of day.items; track m.id) {
                        <button
                          type="button"
                          class="cal-item"
                          [class.cal-item--campaign]="m.kind === 'CAMPAIGN'"
                          (click)="openEditor(m)"
                          [title]="scopeLabel(m)"
                        >
                          ×{{ m.value }}
                          {{ 'admin.promotions.kinds.' + m.kind | translate }}
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          } @else {
            @if (courseFilter()) {
              <p class="small chip-row">
                <cdf-badge variant="info" [subtle]="true">{{
                  'admin.promotions.courseFilter'
                    | translate: { course: courseName(courseFilter()) }
                }}</cdf-badge>
              </p>
            }
            @if (filtered().length === 0) {
              <cdf-empty-state
                icon="calendar"
                [title]="'admin.promotions.emptyTitle' | translate"
                [description]="'admin.promotions.emptyDescription' | translate"
              />
            } @else {
              <div class="table-scroll">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        {{ 'admin.promotions.kind' | translate }}
                      </th>
                      <th scope="col" class="num">
                        {{ 'admin.promotions.value' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.promotions.target' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.promotions.scope' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.promotions.window' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.common.status' | translate }}
                      </th>
                      <th scope="col">
                        <span class="visually-hidden">{{
                          'admin.common.actions' | translate
                        }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of filtered(); track m.id) {
                      <tr [attr.data-multiplier]="m.id">
                        <td>
                          {{ 'admin.promotions.kinds.' + m.kind | translate }}
                          @if (m.description) {
                            <div class="muted small">{{ m.description }}</div>
                          }
                        </td>
                        <td class="num">
                          <strong>×{{ m.value }}</strong>
                        </td>
                        <td>
                          {{
                            'admin.promotions.targets.' + m.target | translate
                          }}
                        </td>
                        <td class="small">{{ scopeLabel(m) }}</td>
                        <td class="small">
                          {{
                            m.startsAt ? (m.startsAt | locale: 'datetime') : '…'
                          }}
                          →
                          {{ m.endsAt ? (m.endsAt | locale: 'datetime') : '…' }}
                        </td>
                        <td>
                          <cdf-badge
                            [variant]="
                              m.activeNow
                                ? 'success'
                                : m.isActive
                                  ? 'neutral'
                                  : 'warning'
                            "
                            [subtle]="true"
                            >{{
                              (m.activeNow
                                ? 'admin.promotions.running'
                                : m.isActive
                                  ? 'admin.promotions.idle'
                                  : 'admin.common.inactive'
                              ) | translate
                            }}</cdf-badge
                          >
                        </td>
                        <td>
                          <div class="row-actions">
                            @if (!m.activeNow) {
                              <cdf-button
                                kind="secondary"
                                size="sm"
                                [loading]="busyId() === m.id"
                                (click)="activateFor24h(m)"
                              >
                                {{ 'admin.promotions.activate24h' | translate }}
                              </cdf-button>
                            }
                            <cdf-button
                              kind="ghost"
                              size="sm"
                              (click)="openEditor(m)"
                              >{{ 'admin.common.edit' | translate }}</cdf-button
                            >
                            <cdf-icon-button
                              icon="trash"
                              size="sm"
                              kind="danger"
                              [ariaLabel]="
                                'admin.promotions.deleteAria' | translate
                              "
                              (click)="remove(m)"
                            />
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </section>

        <section class="admin-card" aria-labelledby="preview-title">
          <cdf-multiplier-preview [courses]="courses()" />
        </section>
      }
    </div>

    <ng-template #promo let-m>
      <article class="promo">
        <strong>×{{ m.value }}</strong>
        <span
          >{{ 'admin.promotions.kinds.' + m.kind | translate }} ·
          {{ 'admin.promotions.targets.' + m.target | translate }}</span
        >
        <span class="muted small">{{ scopeLabel(m) }}</span>
        <span class="muted small">
          {{ m.startsAt ? (m.startsAt | locale: 'datetime') : '…' }} →
          {{ m.endsAt ? (m.endsAt | locale: 'datetime') : '…' }}
        </span>
      </article>
    </ng-template>

    <cdf-drawer
      [(open)]="editorOpen"
      size="lg"
      [title]="
        (editingId() ? 'admin.promotions.edit' : 'admin.promotions.new')
          | translate
      "
    >
      <cdf-multiplier-editor
        [value]="editorValue()"
        [courseOptions]="courseOptions()"
        [lessonOptions]="lessonOptions()"
        [saving]="saving()"
        (draftChange)="onDraft($event)"
        (save)="save($event)"
        (cancelled)="editorOpen.set(false)"
      />
      @if (editorError(); as e) {
        <p class="form-error" role="alert">{{ e }}</p>
      }
    </cdf-drawer>
  `,
  styles: [
    `
      /* Contain visually-hidden labels so they can't widen the page. */
      .table-scroll {
        position: relative;
      }
      .promo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 0 var(--cdf-space-4);
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .view-toggle {
        display: inline-flex;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        overflow: hidden;
        button {
          border: 0;
          background: var(--cdf-color-surface);
          color: var(--cdf-color-text);
          padding: 4px 12px;
          font-size: var(--cdf-font-size-sm);
        }
        button.active {
          background: var(--cdf-color-primary);
          color: var(--cdf-color-primary-on);
        }
        button:focus-visible {
          box-shadow: var(--cdf-shadow-focus-ring);
          outline: none;
        }
      }
      .cal-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .calendar {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        overflow-x: auto;
      }
      .cal-row {
        display: grid;
        grid-template-columns: repeat(7, minmax(90px, 1fr));
      }
      .cal-dow {
        padding: 4px 6px;
        font-size: 12px;
        font-weight: 600;
        color: var(--cdf-color-text-muted);
        border-bottom: 1px solid var(--cdf-color-border);
      }
      .cal-day {
        min-height: 84px;
        padding: 4px;
        border-right: 1px solid var(--cdf-color-border);
        border-bottom: 1px solid var(--cdf-color-border);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .calendar--week .cal-day {
        min-height: 160px;
      }
      .cal-day.out {
        background: var(--cdf-color-bg);
        color: var(--cdf-color-text-subtle);
      }
      .cal-day.today .cal-date {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-primary-on);
        border-radius: 999px;
        padding: 0 6px;
      }
      .cal-date {
        align-self: flex-start;
        font-size: 12px;
      }
      .cal-item {
        border: 0;
        border-radius: 4px;
        padding: 1px 4px;
        font-size: 11px;
        text-align: start;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        background: var(--cdf-color-info);
        color: var(--cdf-color-info-on);
      }
      .cal-item--campaign {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-primary-on);
      }
      .promo {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 0;
        border-top: 1px solid var(--cdf-color-border);
      }
    `,
  ],
})
export class PromotionsPage implements HasUnsavedChanges {
  /** `?courseId=` (from the course detail Promotions tab). */
  readonly courseId = input<string | undefined>(undefined);

  private readonly client = inject(GamificationClient);
  private readonly coursesClient = inject(CoursesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly rows = signal<Multiplier[] | null>(null);
  protected readonly loadError = signal<unknown>(null);
  protected readonly views = ['list', 'calendar'] as const;
  protected readonly view = signal<'list' | 'calendar'>('list');
  protected readonly calModes: readonly CalendarMode[] = ['week', 'month'];
  protected readonly calMode = signal<CalendarMode>('month');
  protected readonly anchor = signal(new Date());
  protected readonly windowFilter = signal<WindowFilter>('all');
  protected readonly range = signal<DateRange>({ start: null, end: null });
  /** The editor emits only on user edits, so any emit means unsaved work. */
  private draftChanged = false;
  protected readonly kindFilter = signal<MultiplierKind | ''>('');
  protected readonly busyId = signal<string | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly editorValue = signal<MultiplierDraft | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editorError = signal<string | null>(null);
  protected readonly courses = signal<{ id: string; title: string }[]>([]);
  protected readonly lessonOptions = signal<ComboboxOption<string>[]>([]);
  private lessonsFor: string | null = null;

  protected readonly courseFilter = computed(() => this.courseId() ?? null);
  protected readonly buckets = computed(() =>
    bucketPromotions(this.rows() ?? [], new Date()),
  );
  protected readonly filtered = computed(() => {
    const k = this.kindFilter();
    const c = this.courseFilter();
    const w = this.windowFilter();
    const r = this.range();
    const now = new Date();
    const range = {
      from: r.start ? new Date(r.start) : null,
      // Inclusive end day.
      to: r.end ? new Date(new Date(r.end).getTime() + 86_400_000) : null,
    };
    return (this.rows() ?? []).filter(
      (m) =>
        (!k || m.kind === k) &&
        (!c || m.courseId === c) &&
        matchesWindow(m, w, now, range),
    );
  });

  protected readonly windowFilterOptions = computed<
    SelectOption<WindowFilter>[]
  >(() => {
    this.i18n.currentLocale();
    return WINDOW_FILTERS.map((w) => ({
      value: w,
      label: this.i18n.t(`admin.promotions.windows.${w}`),
    }));
  });

  protected readonly calendarTitle = computed(() => {
    const locale = this.i18n.currentLocale();
    const a = this.anchor();
    if (this.calMode() === 'month')
      return new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(a);
    const days = calendarDays(a, 'week');
    const f = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
    });
    return `${f.format(days[0])} – ${f.format(days[6])}`;
  });

  protected readonly weekdays = computed(() => {
    const locale = this.i18n.currentLocale();
    const f = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return calendarDays(new Date(2026, 10, 2), 'week').map((d) => f.format(d));
  });

  protected readonly calendarWeeks = computed(() => {
    const locale = this.i18n.currentLocale();
    const a = this.anchor();
    const rows = this.filtered().filter((m) => CALENDAR_KINDS.includes(m.kind));
    const today = new Date().toDateString();
    const label = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
    const days = calendarDays(a, this.calMode()).map((date) => ({
      key: date.toISOString(),
      date,
      outside: this.calMode() === 'month' && date.getMonth() !== a.getMonth(),
      today: date.toDateString() === today,
      label: label.format(date),
      items: onDay(rows, date),
    }));
    const weeks: (typeof days)[] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return weeks;
  });
  protected readonly courseOptions = computed<ComboboxOption<string>[]>(() =>
    this.courses().map((c) => ({ value: c.id, label: c.title })),
  );
  protected readonly kindFilterOptions = computed<
    SelectOption<MultiplierKind | ''>[]
  >(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.promotions.allKinds') },
      ...MULTIPLIER_KINDS.map((k) => ({
        value: k,
        label: this.i18n.t(`admin.promotions.kinds.${k}`),
      })),
    ];
  });

  constructor() {
    void this.refresh();
    void this.loadCourses();
  }

  hasUnsavedChanges(): boolean {
    return this.editorOpen() && this.draftChanged;
  }

  protected today(): Date {
    return new Date();
  }

  protected shift(dir: -1 | 1): void {
    this.anchor.set(shiftAnchor(this.anchor(), this.calMode(), dir));
  }

  protected async refresh(): Promise<void> {
    this.loadError.set(null);
    this.rows.set(null);
    try {
      // Per-user surprise boosts (docs/10 §6) aren't catalog promotions.
      this.rows.set(
        (await this.client.listMultipliers()).filter(
          (m) => (m.kind as string) !== 'SURPRISE_BOOST',
        ),
      );
    } catch (err) {
      this.loadError.set(err);
    }
  }

  private async loadCourses(): Promise<void> {
    try {
      const res = await this.coursesClient.list({ take: 200 });
      this.courses.set(res.items.map((c) => ({ id: c.id, title: c.title })));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected courseName(id: string | null): string {
    return this.courses().find((c) => c.id === id)?.title ?? id ?? '';
  }

  protected scopeLabel(m: Multiplier): string {
    if (m.lessonId)
      return this.i18n.t('admin.promotions.scopeLesson', {
        course: this.courseName(m.courseId),
      });
    if (m.courseId)
      return this.i18n.t('admin.promotions.scopeCourse', {
        course: this.courseName(m.courseId),
      });
    if (m.kind === 'STREAK_TIER')
      return this.i18n.t('admin.promotions.scopeStreak', {
        days: m.streakDaysMin ?? 0,
      });
    return this.i18n.t('admin.promotions.scopeGlobal');
  }

  protected openEditor(m: Multiplier | null): void {
    this.editingId.set(m?.id ?? null);
    const preset = this.courseFilter();
    this.editorValue.set(
      m
        ? toDraft(m)
        : preset
          ? { ...emptyDraft(), kind: 'COURSE_PROMO', courseId: preset }
          : null,
    );
    this.editorError.set(null);
    void this.ensureLessons(m?.courseId ?? preset);
    this.draftChanged = false;
    this.editorOpen.set(true);
  }

  protected onDraft(d: MultiplierDraft): void {
    this.draftChanged = true;
    void this.ensureLessons(d.courseId);
  }

  /** Lesson options for the scope picker follow the chosen course. */
  private async ensureLessons(
    courseId: string | null | undefined,
  ): Promise<void> {
    if (!courseId || courseId === this.lessonsFor) return;
    this.lessonsFor = courseId;
    try {
      const c = await this.coursesClient.detail(courseId);
      if (this.lessonsFor !== courseId) return;
      this.lessonOptions.set(
        c.modules.flatMap((m) =>
          m.lessons.map((l) => ({
            value: l.id,
            label: l.title,
            description: m.title,
          })),
        ),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async save(d: MultiplierDraft): Promise<void> {
    this.saving.set(true);
    this.editorError.set(null);
    try {
      const id = this.editingId();
      const saved = id
        ? await this.client.updateMultiplier(id, toBody(d))
        : await this.client.createMultiplier(toBody(d));
      this.rows.update((rs) =>
        id
          ? (rs ?? []).map((r) => (r.id === saved.id ? saved : r))
          : [saved, ...(rs ?? [])],
      );
      this.toast.success(this.i18n.t('admin.promotions.saved'));
      this.draftChanged = false;
      this.editorOpen.set(false);
    } catch (err) {
      this.editorError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async activateFor24h(m: Multiplier): Promise<void> {
    const now = new Date();
    this.busyId.set(m.id);
    try {
      const saved = await this.client.updateMultiplier(m.id, {
        isActive: true,
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 86_400_000).toISOString(),
      });
      this.rows.update((rs) =>
        (rs ?? []).map((r) => (r.id === saved.id ? saved : r)),
      );
      this.toast.success(this.i18n.t('admin.promotions.activated'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busyId.set(null);
    }
  }

  protected async remove(m: Multiplier): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.promotions.deleteTitle', { value: m.value }),
      message: this.i18n.t('admin.promotions.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.client.deleteMultiplier(m.id);
      this.rows.update((rs) => (rs ?? []).filter((r) => r.id !== m.id));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }
}

function emptyDraft(): MultiplierDraft {
  return {
    kind: 'CAMPAIGN',
    target: 'BOTH',
    value: 2,
    startsAt: null,
    endsAt: null,
    courseId: null,
    lessonId: null,
    streakDaysMin: null,
    description: null,
    isActive: true,
  };
}
