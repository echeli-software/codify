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
    kind: m.kind,
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
    Drawer,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    MultiplierEditor,
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

      @if (rows() === null) {
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
          </header>
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
                    <th scope="col">{{ 'admin.common.status' | translate }}</th>
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
                        {{ 'admin.promotions.targets.' + m.target | translate }}
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
      .promo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 0 var(--cdf-space-4);
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
export class PromotionsPage {
  /** `?courseId=` (from the course detail Promotions tab). */
  readonly courseId = input<string | undefined>(undefined);

  private readonly client = inject(GamificationClient);
  private readonly coursesClient = inject(CoursesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly rows = signal<Multiplier[] | null>(null);
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
    return (this.rows() ?? []).filter(
      (m) => (!k || m.kind === k) && (!c || m.courseId === c),
    );
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

  private async refresh(): Promise<void> {
    try {
      this.rows.set(await this.client.listMultipliers());
    } catch (err) {
      this.rows.set([]);
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
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
    this.editorOpen.set(true);
  }

  protected onDraft(d: MultiplierDraft): void {
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
