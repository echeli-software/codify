import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService, RoleDirective } from '@codify/auth';
import {
  AssetPicker,
  type AssetSummary,
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  Chip,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  Select,
  type SelectOption,
  Skeleton,
  Textarea,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  CategoriesClient,
  CoursesClient,
  GamificationClient,
  LessonsClient,
  ModulesClient,
  PlansClient,
  ProblemDetailsError,
  type Category,
  type CourseDetail,
  type CourseLessonSummary,
  type CourseModuleSummary,
  type LessonType,
  type Multiplier,
  type Plan,
  type UpdateCourseBody,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES, canAccess } from '../core/roles';
import {
  LESSON_TYPES,
  SLUG_PATTERN,
  lessonCompanion,
  statusVariant,
} from '../core/catalog';

type Tab = 'overview' | 'curriculum' | 'promotions';
type CourseView = CourseDetail;

interface OverviewForm {
  title: string;
  slug: string;
  description: string;
  difficulty: number;
  estimatedMinutes: number;
  categoryIds: string[];
  isCapstone: boolean;
}

/**
 * Course detail (docs/04 "Catalog → Course"): Overview (metadata, capstone
 * flag, cover, categories, plans including the course, publish/archive),
 * Curriculum (modules + lessons, free toggle, add/delete) and Promotions
 * (course-scoped multipliers, ADMIN). The `:slug` param is followed with
 * `takeUntilDestroyed`; a load sequence number drops stale responses when
 * the slug changes mid-flight.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    RoleDirective,
    AssetPicker,
    Badge,
    BreadcrumbBar,
    Button,
    Chip,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    Select,
    Skeleton,
    Textarea,
    Toggle,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <cdf-breadcrumb-bar [crumbs]="crumbs()" />

      @if (course(); as c) {
        <header class="page-head">
          <div>
            <h1>{{ c.title }}</h1>
            <p class="muted chip-row">
              <cdf-badge [variant]="statusVariant(c.status)" [subtle]="true">
                {{ 'admin.courseStatus.' + c.status | translate }}
              </cdf-badge>
              @if (c.isCapstone) {
                <cdf-badge variant="premium" [subtle]="true">{{
                  'admin.courses.capstone' | translate
                }}</cdf-badge>
              }
              <span>{{
                'admin.course.meta'
                  | translate
                    : {
                        author: c.authorDisplayName,
                        modules: c.moduleCount,
                        lessons: c.lessonCount,
                      }
              }}</span>
            </p>
          </div>
          <div class="page-head__actions" *codifyIfRole="editRoles">
            @if (c.status !== 'PUBLISHED') {
              <cdf-button
                kind="primary"
                [loading]="busy() === 'publish'"
                (click)="publish()"
              >
                {{ 'admin.courses.publish' | translate }}
              </cdf-button>
            }
            @if (c.status === 'PUBLISHED') {
              <cdf-button
                kind="secondary"
                [loading]="busy() === 'archive'"
                (click)="archive()"
              >
                {{ 'admin.courses.archive' | translate }}
              </cdf-button>
            }
          </div>
        </header>

        <div class="tabs" role="tablist">
          @for (t of tabs(); track t) {
            <button
              type="button"
              role="tab"
              [id]="'tab-' + t"
              [attr.aria-selected]="tab() === t"
              [attr.aria-controls]="'panel-' + t"
              (click)="tab.set(t)"
            >
              {{ 'admin.course.tabs.' + t | translate }}
            </button>
          }
        </div>

        @switch (tab()) {
          @case ('overview') {
            <section
              id="panel-overview"
              role="tabpanel"
              aria-labelledby="tab-overview"
              class="split"
            >
              <div class="admin-card">
                <h2>{{ 'admin.course.basics' | translate }}</h2>
                <fieldset class="plain" [disabled]="!canEdit()">
                  <div class="form-grid form-grid--2">
                    <cdf-form-field
                      [label]="'admin.courses.fields.title' | translate"
                      controlId="c-title"
                      [error]="errors()['title'] ?? null"
                    >
                      <cdf-input inputId="c-title" [(ngModel)]="form.title" />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.common.slug' | translate"
                      [help]="'admin.courses.fields.slugHelp' | translate"
                      controlId="c-slug"
                      [error]="errors()['slug'] ?? null"
                    >
                      <cdf-input inputId="c-slug" [(ngModel)]="form.slug" />
                    </cdf-form-field>
                    <cdf-form-field
                      class="span-all"
                      [label]="'admin.common.description' | translate"
                    >
                      <cdf-textarea [(ngModel)]="form.description" [rows]="3" />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.course.difficulty' | translate"
                      [help]="'admin.course.difficultyHelp' | translate"
                      controlId="c-difficulty"
                    >
                      <cdf-input
                        inputId="c-difficulty"
                        type="number"
                        [(ngModel)]="form.difficulty"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.course.estimatedMinutes' | translate"
                      controlId="c-minutes"
                    >
                      <cdf-input
                        inputId="c-minutes"
                        type="number"
                        [(ngModel)]="form.estimatedMinutes"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      class="span-all"
                      [label]="'admin.course.categories' | translate"
                      controlId="c-categories"
                    >
                      <cdf-select
                        inputId="c-categories"
                        [multiple]="true"
                        [options]="categoryOptions()"
                        [(ngModel)]="form.categoryIds"
                      />
                    </cdf-form-field>
                    <div class="span-all">
                      <cdf-toggle
                        [(ngModel)]="form.isCapstone"
                        [label]="'admin.course.capstoneToggle' | translate"
                        data-testid="capstone-toggle"
                      />
                      <p class="muted small">
                        {{ 'admin.course.capstoneHelp' | translate }}
                      </p>
                    </div>
                  </div>
                </fieldset>
                @if (canEdit()) {
                  <div class="form-actions">
                    <cdf-button
                      kind="primary"
                      [loading]="busy() === 'save'"
                      (click)="saveOverview()"
                      data-testid="save-course"
                    >
                      {{ 'admin.common.saveChanges' | translate }}
                    </cdf-button>
                  </div>
                }
                @if (formError(); as e) {
                  <p class="form-error" role="alert">{{ e }}</p>
                }
              </div>

              <div>
                <div class="admin-card">
                  <h2>{{ 'admin.course.cover' | translate }}</h2>
                  <cdf-asset-picker
                    kind="COVER"
                    [(ngModel)]="cover"
                    [disabled]="!canEdit()"
                    [placeholder]="'admin.course.coverNone' | translate"
                  />
                  @if (canEdit()) {
                    <div class="form-actions">
                      <cdf-button
                        kind="secondary"
                        size="sm"
                        [disabled]="!coverDirty"
                        [loading]="busy() === 'cover'"
                        (click)="saveCover()"
                      >
                        {{ 'admin.course.saveCover' | translate }}
                      </cdf-button>
                    </div>
                  }
                </div>
                <div class="admin-card">
                  <h2>{{ 'admin.course.plans' | translate }}</h2>
                  @if (plans() === null) {
                    <cdf-skeleton shape="text" />
                  } @else if (plans()!.length === 0) {
                    <p class="muted small">
                      {{ 'admin.course.noPlans' | translate }}
                    </p>
                  } @else {
                    <div class="chip-row">
                      @for (p of plans(); track p.id) {
                        <cdf-chip size="sm">{{ p.name }}</cdf-chip>
                      }
                    </div>
                  }
                </div>
                <div class="admin-card">
                  <h2>{{ 'admin.course.details' | translate }}</h2>
                  <dl class="kv">
                    <dt>{{ 'admin.course.sourceLocale' | translate }}</dt>
                    <dd>{{ c.sourceLocale }}</dd>
                    <dt>{{ 'admin.common.createdAt' | translate }}</dt>
                    <dd>{{ c.createdAt | locale: 'datetime' }}</dd>
                    <dt>{{ 'admin.course.publishedAt' | translate }}</dt>
                    <dd>
                      {{
                        c.publishedAt
                          ? (c.publishedAt | locale: 'datetime')
                          : ('admin.common.none' | translate)
                      }}
                    </dd>
                  </dl>
                </div>
              </div>
            </section>
          }
          @case ('curriculum') {
            <section
              id="panel-curriculum"
              role="tabpanel"
              aria-labelledby="tab-curriculum"
              class="admin-card"
            >
              <header class="section-head">
                <h2>{{ 'admin.course.modules' | translate }}</h2>
                <cdf-button
                  *codifyIfRole="editRoles"
                  kind="primary"
                  size="sm"
                  (click)="moduleFormOpen.set(true)"
                  data-testid="add-module"
                >
                  <cdf-icon name="plus" size="sm" />
                  {{ 'admin.course.addModule' | translate }}
                </cdf-button>
              </header>

              @if (moduleFormOpen()) {
                <div class="inline-form">
                  <cdf-form-field
                    [label]="'admin.course.moduleTitle' | translate"
                    controlId="new-module-title"
                    [error]="moduleError()"
                  >
                    <cdf-input
                      inputId="new-module-title"
                      [(ngModel)]="newModuleTitle"
                    />
                  </cdf-form-field>
                  <div class="form-actions">
                    <cdf-button
                      kind="primary"
                      size="sm"
                      [loading]="busy() === 'module'"
                      (click)="saveModule()"
                      data-testid="create-module"
                    >
                      {{ 'admin.course.createModule' | translate }}
                    </cdf-button>
                    <cdf-button
                      kind="ghost"
                      size="sm"
                      (click)="moduleFormOpen.set(false)"
                    >
                      {{ 'admin.common.cancel' | translate }}
                    </cdf-button>
                  </div>
                </div>
              }

              @if (c.modules.length === 0) {
                <cdf-empty-state
                  icon="folder-open"
                  [title]="'admin.course.noModules' | translate"
                  [description]="'admin.course.noModulesHelp' | translate"
                />
              } @else {
                <ol class="plain-list module-list">
                  @for (m of c.modules; track m.id; let mi = $index) {
                    <li class="module">
                      <header class="section-head">
                        <div>
                          <span class="muted small">{{
                            'admin.course.moduleN' | translate: { n: mi + 1 }
                          }}</span>
                          <h3>{{ m.title }}</h3>
                        </div>
                        <div class="row-actions" *codifyIfRole="editRoles">
                          <cdf-button
                            kind="ghost"
                            size="sm"
                            (click)="openLessonForm(m.id)"
                          >
                            {{ 'admin.course.addLesson' | translate }}
                          </cdf-button>
                          <cdf-icon-button
                            icon="trash"
                            size="sm"
                            kind="danger"
                            [ariaLabel]="
                              'admin.course.deleteModuleAria'
                                | translate: { title: m.title }
                            "
                            (click)="deleteModule(m)"
                          />
                        </div>
                      </header>

                      @if (lessonFormFor() === m.id) {
                        <div class="inline-form form-grid">
                          <cdf-form-field
                            [label]="'admin.course.lessonTitle' | translate"
                            [controlId]="'new-lesson-title-' + m.id"
                            [error]="lessonError()"
                          >
                            <cdf-input
                              [inputId]="'new-lesson-title-' + m.id"
                              [(ngModel)]="newLesson.title"
                            />
                          </cdf-form-field>
                          <cdf-form-field
                            [label]="'admin.course.lessonType' | translate"
                            [controlId]="'new-lesson-type-' + m.id"
                          >
                            <cdf-select
                              [inputId]="'new-lesson-type-' + m.id"
                              [options]="lessonTypeOptions()"
                              [(ngModel)]="newLesson.type"
                            />
                          </cdf-form-field>
                          <div class="form-actions span-all">
                            <cdf-button
                              kind="primary"
                              size="sm"
                              [loading]="busy() === 'lesson'"
                              (click)="saveLesson(m.id)"
                              data-testid="create-lesson"
                            >
                              {{ 'admin.course.createLesson' | translate }}
                            </cdf-button>
                            <cdf-button
                              kind="ghost"
                              size="sm"
                              (click)="lessonFormFor.set(null)"
                            >
                              {{ 'admin.common.cancel' | translate }}
                            </cdf-button>
                          </div>
                        </div>
                      }

                      @if (m.lessons.length > 0) {
                        <ul class="plain-list lesson-list">
                          @for (l of m.lessons; track l.id; let li = $index) {
                            <li class="lesson">
                              <span class="muted mono">{{ li + 1 }}</span>
                              <cdf-badge variant="neutral" [subtle]="true">{{
                                'admin.lessonTypes.' + l.type | translate
                              }}</cdf-badge>
                              @if (canEditLessons()) {
                                <a [routerLink]="['/lessons', l.id]">{{
                                  l.title
                                }}</a>
                              } @else {
                                <span>{{ l.title }}</span>
                              }
                              <span class="muted small">{{
                                'admin.common.minutes'
                                  | translate: { n: l.estimatedMinutes }
                              }}</span>
                              <cdf-toggle
                                [ngModel]="l.isFree"
                                (ngModelChange)="toggleFree(m, l, $event)"
                                [disabled]="!canEditLessons()"
                                [label]="'admin.course.free' | translate"
                              />
                              @if (
                                canEditLessons() && companion(l.type);
                                as comp
                              ) {
                                <a
                                  class="small"
                                  [routerLink]="['/lessons', l.id, comp]"
                                  >{{
                                    'admin.course.companion.' + comp | translate
                                  }}</a
                                >
                              } @else {
                                <span></span>
                              }
                            </li>
                          }
                        </ul>
                      }
                    </li>
                  }
                </ol>
              }
            </section>
          }
          @case ('promotions') {
            <section
              id="panel-promotions"
              role="tabpanel"
              aria-labelledby="tab-promotions"
              class="admin-card"
            >
              <header class="section-head">
                <h2>{{ 'admin.course.promotions' | translate }}</h2>
                <a
                  [routerLink]="['/promotions']"
                  [queryParams]="{ courseId: c.id }"
                  >{{ 'admin.course.managePromotions' | translate }}</a
                >
              </header>
              @if (multipliers().length === 0) {
                <p class="muted small">
                  {{ 'admin.course.noPromotions' | translate }}
                </p>
              } @else {
                <ul class="plain-list">
                  @for (mu of multipliers(); track mu.id) {
                    <li class="chip-row">
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
                      <span>{{
                        'admin.promotions.kinds.' + mu.kind | translate
                      }}</span>
                      <span class="muted small"
                        >{{
                          mu.startsAt ? (mu.startsAt | locale: 'datetime') : '…'
                        }}
                        →
                        {{
                          mu.endsAt ? (mu.endsAt | locale: 'datetime') : '…'
                        }}</span
                      >
                    </li>
                  }
                </ul>
              }
            </section>
          }
        }
      } @else if (notFound()) {
        <cdf-empty-state
          icon="x-circle"
          [title]="'admin.course.notFound' | translate"
          [description]="'admin.course.notFoundHelp' | translate"
        >
          <a [routerLink]="['/courses']">{{
            'admin.course.backToCourses' | translate
          }}</a>
        </cdf-empty-state>
      } @else {
        <cdf-skeleton shape="rect" height="240px" />
      }
    </div>
  `,
  styles: [
    `
      fieldset.plain {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      .inline-form {
        background: var(--cdf-color-bg);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .module-list {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .module {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
        h3 {
          margin: 2px 0 0;
        }
      }
      .lesson {
        display: grid;
        grid-template-columns: 24px 110px minmax(0, 1fr) 70px 110px 120px;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 6px 0;
        border-top: 1px solid var(--cdf-color-border);
      }
      @media (max-width: 760px) {
        .lesson {
          grid-template-columns: 24px minmax(0, 1fr);
        }
      }
      .kv {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
        margin: 0;
        font-size: 14px;
        dt {
          color: var(--cdf-color-text-muted);
        }
        dd {
          margin: 0;
        }
      }
    `,
  ],
})
export class CourseDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly courses = inject(CoursesClient);
  private readonly modulesClient = inject(ModulesClient);
  private readonly lessonsClient = inject(LessonsClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly plansClient = inject(PlansClient);
  private readonly gamification = inject(GamificationClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly editRoles = EDIT_ROLES.catalog;
  protected readonly statusVariant = statusVariant;
  protected readonly companion = lessonCompanion;
  protected readonly canEdit = computed(() =>
    this.auth.hasAnyRole(EDIT_ROLES.catalog),
  );
  protected readonly canEditLessons = computed(() =>
    canAccess('courseEditing', this.auth.role()),
  );
  protected readonly tabs = computed<Tab[]>(() =>
    canAccess('promotions', this.auth.role())
      ? ['overview', 'curriculum', 'promotions']
      : ['overview', 'curriculum'],
  );
  protected readonly tab = signal<Tab>('overview');

  protected readonly course = signal<CourseView | null>(null);
  protected readonly notFound = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly plans = signal<Plan[] | null>(null);
  protected readonly multipliers = signal<Multiplier[]>([]);

  protected form: OverviewForm = emptyForm();
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
  protected cover: AssetSummary | null = null;
  private initialCoverId: string | null = null;

  protected readonly moduleFormOpen = signal(false);
  protected newModuleTitle = '';
  protected readonly moduleError = signal<string | null>(null);
  protected readonly lessonFormFor = signal<string | null>(null);
  protected newLesson: { title: string; type: LessonType } = {
    title: '',
    type: 'READING',
  };
  protected readonly lessonError = signal<string | null>(null);

  /** Bumped per load; responses from an older slug are discarded. */
  private loadSeq = 0;

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    this.i18n.currentLocale();
    return [
      { label: this.i18n.t('admin.nav.courses'), routerLink: ['/courses'] },
      { label: this.course()?.title ?? this.i18n.t('admin.course.course') },
    ];
  });

  protected readonly categoryOptions = computed<SelectOption<string>[]>(() =>
    this.categories().map((c) => ({ value: c.id, label: c.name })),
  );

  protected readonly lessonTypeOptions = computed<SelectOption<LessonType>[]>(
    () => {
      this.i18n.currentLocale();
      return LESSON_TYPES.map((t) => ({
        value: t,
        label: this.i18n.t(`admin.lessonTypes.${t}`),
      }));
    },
  );

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => p.get('slug')),
        takeUntilDestroyed(),
      )
      .subscribe((slug) => {
        if (slug) void this.load(slug);
      });
    void this.loadCategories();
  }

  protected get coverDirty(): boolean {
    return (this.cover?.id ?? null) !== this.initialCoverId;
  }

  private async load(slug: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.notFound.set(false);
    this.course.set(null);
    this.plans.set(null);
    try {
      const course = (await this.courses.detail(slug)) as CourseView;
      if (seq !== this.loadSeq) return;
      this.setCourse(course);
      void this.loadSideData(course.id, seq);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      if (err instanceof ProblemDetailsError && err.isNotFound) {
        this.notFound.set(true);
      } else {
        this.errorsSvc.toast(err, 'admin.errors.loadFailed');
      }
    }
  }

  private setCourse(c: CourseView): void {
    this.course.set(c);
    this.form = {
      title: c.title,
      slug: c.slug,
      description: c.description ?? '',
      difficulty: c.difficulty,
      estimatedMinutes: c.estimatedMinutes,
      categoryIds: [...c.categoryIds],
      isCapstone: !!c.isCapstone,
    };
    // The picker only needs id + url to show the current cover.
    this.cover =
      c.coverAssetId && c.coverUrl
        ? {
            id: c.coverAssetId,
            url: c.coverUrl,
            kind: 'COVER',
            mimeType: 'image/*',
            sizeBytes: 0,
          }
        : null;
    this.initialCoverId = this.cover?.id ?? null;
  }

  private async loadSideData(courseId: string, seq: number): Promise<void> {
    try {
      const res = await this.plansClient.list({
        courseId,
        includeInactive: true,
      });
      if (seq === this.loadSeq) this.plans.set(res.items);
    } catch {
      if (seq === this.loadSeq) this.plans.set([]);
    }
    if (canAccess('promotions', this.auth.role())) {
      try {
        const all = await this.gamification.listMultipliers();
        if (seq === this.loadSeq)
          this.multipliers.set(all.filter((m) => m.courseId === courseId));
      } catch (err) {
        if (seq === this.loadSeq)
          this.errorsSvc.toast(err, 'admin.errors.loadFailed');
      }
    }
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories.set(
        (await this.categoriesClient.list({ take: 100 })).items,
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async saveOverview(): Promise<void> {
    const c = this.course();
    if (!c) return;
    const errs: Record<string, string> = {};
    if (!this.form.title.trim())
      errs['title'] = this.i18n.t('admin.common.required');
    if (!SLUG_PATTERN.test(this.form.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    this.errors.set(errs);
    if (Object.keys(errs).length) return;

    const body: UpdateCourseBody = {
      title: this.form.title.trim(),
      slug: this.form.slug.trim(),
      description: this.form.description.trim(),
      difficulty: Math.min(
        5,
        Math.max(1, Math.round(Number(this.form.difficulty) || 1)),
      ),
      estimatedMinutes: Math.max(
        1,
        Math.round(Number(this.form.estimatedMinutes) || 1),
      ),
      categoryIds: this.form.categoryIds,
      isCapstone: this.form.isCapstone,
    };
    this.busy.set('save');
    this.formError.set(null);
    try {
      await this.courses.update(c.id, body);
      // Re-read so modules/lessons and computed fields stay canonical.
      const fresh = (await this.courses.detail(c.id)) as CourseView;
      this.setCourse(fresh);
      this.toast.success(this.i18n.t('admin.course.saved'));
      void this.loadSideData(fresh.id, this.loadSeq);
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async saveCover(): Promise<void> {
    const c = this.course();
    if (!c) return;
    this.busy.set('cover');
    try {
      await this.courses.update(c.id, {
        coverAssetId: this.cover?.id ?? null,
      });
      this.initialCoverId = this.cover?.id ?? null;
      this.toast.success(this.i18n.t('admin.course.coverSaved'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async publish(): Promise<void> {
    await this.statusAction('publish', (id) => this.courses.publish(id));
  }

  protected async archive(): Promise<void> {
    await this.statusAction('archive', (id) => this.courses.archive(id));
  }

  private async statusAction(
    kind: 'publish' | 'archive',
    fn: (id: string) => Promise<unknown>,
  ): Promise<void> {
    const c = this.course();
    if (!c) return;
    this.busy.set(kind);
    try {
      await fn(c.id);
      this.setCourse((await this.courses.detail(c.id)) as CourseView);
      this.toast.success(
        this.i18n.t(
          kind === 'publish'
            ? 'admin.courses.published'
            : 'admin.courses.archived',
          { title: c.title },
        ),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(null);
    }
  }

  // ─── Curriculum ───────────────────────────────────────────────────────

  protected async saveModule(): Promise<void> {
    const c = this.course();
    const title = this.newModuleTitle.trim();
    if (!c) return;
    if (!title) {
      this.moduleError.set(this.i18n.t('admin.common.required'));
      return;
    }
    this.moduleError.set(null);
    this.busy.set('module');
    try {
      const created = await this.modulesClient.create(c.id, { title });
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              moduleCount: cur.moduleCount + 1,
              modules: [
                ...cur.modules,
                { id: created.id, order: created.order, title, lessons: [] },
              ],
            }
          : cur,
      );
      this.newModuleTitle = '';
      this.moduleFormOpen.set(false);
      this.toast.success(this.i18n.t('admin.course.moduleCreated', { title }));
    } catch (err) {
      this.moduleError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteModule(m: CourseModuleSummary): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: m.title }),
      message: this.i18n.t('admin.course.deleteModuleMessage', {
        count: m.lessons.length,
      }),
      confirmKind: 'danger',
      confirmLabel: this.i18n.t('admin.common.delete'),
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.modulesClient.remove(m.id);
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              moduleCount: Math.max(0, cur.moduleCount - 1),
              lessonCount: Math.max(0, cur.lessonCount - m.lessons.length),
              modules: cur.modules.filter((x) => x.id !== m.id),
            }
          : cur,
      );
      this.toast.success(
        this.i18n.t('admin.course.moduleDeleted', { title: m.title }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }

  protected openLessonForm(moduleId: string): void {
    this.newLesson = { title: '', type: 'READING' };
    this.lessonError.set(null);
    this.lessonFormFor.set(moduleId);
  }

  protected async saveLesson(moduleId: string): Promise<void> {
    const title = this.newLesson.title.trim();
    if (!title) {
      this.lessonError.set(this.i18n.t('admin.common.required'));
      return;
    }
    this.lessonError.set(null);
    this.busy.set('lesson');
    try {
      const created = await this.lessonsClient.create(moduleId, {
        title,
        type: this.newLesson.type,
      });
      const summary: CourseLessonSummary = {
        id: created.id,
        order: created.order,
        type: created.type,
        isFree: created.isFree,
        estimatedMinutes: created.estimatedMinutes,
        title: created.title,
      };
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              lessonCount: cur.lessonCount + 1,
              modules: cur.modules.map((m) =>
                m.id === moduleId
                  ? { ...m, lessons: [...m.lessons, summary] }
                  : m,
              ),
            }
          : cur,
      );
      this.lessonFormFor.set(null);
      this.toast.success(this.i18n.t('admin.course.lessonCreated', { title }));
    } catch (err) {
      this.lessonError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async toggleFree(
    m: CourseModuleSummary,
    l: CourseLessonSummary,
    isFree: boolean,
  ): Promise<void> {
    const patch = (free: boolean) =>
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              modules: cur.modules.map((mm) =>
                mm.id === m.id
                  ? {
                      ...mm,
                      lessons: mm.lessons.map((ll) =>
                        ll.id === l.id ? { ...ll, isFree: free } : ll,
                      ),
                    }
                  : mm,
              ),
            }
          : cur,
      );
    patch(isFree); // optimistic
    try {
      await this.lessonsClient.update(l.id, { isFree });
    } catch (err) {
      patch(!isFree); // rollback
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    }
  }
}

function emptyForm(): OverviewForm {
  return {
    title: '',
    slug: '',
    description: '',
    difficulty: 1,
    estimatedMinutes: 30,
    categoryIds: [],
    isCapstone: false,
  };
}
