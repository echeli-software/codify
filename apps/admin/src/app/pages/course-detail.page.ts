import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
  type CroppedImage,
  EmptyState,
  FormField,
  Icon,
  ImageCropper,
  Input,
  Select,
  type SelectOption,
  Skeleton,
  Textarea,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  AssetsClient,
  CategoriesClient,
  CoursesClient,
  PlansClient,
  ProblemDetailsError,
  type Category,
  type CourseDetail,
  type Plan,
  type UpdateCourseBody,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES, canAccess } from '../core/roles';
import { SLUG_PATTERN, statusVariant } from '../core/catalog';
import { DirtyTracker } from '../core/dirty';
import { LoadError } from '../core/load-error';
import { toAssetSummary } from '../core/uploads';
import type { HasUnsavedChanges } from '../core/unsaved-changes';
import { CourseCurriculum } from './course-curriculum.component';
import {
  CourseAnalyticsTab,
  CourseAuditTab,
  CourseEnrollmentsTab,
  CourseMultipliersTab,
  CourseTranslationsTab,
} from './course-tabs.component';

type Tab =
  | 'overview'
  | 'curriculum'
  | 'promotions'
  | 'translations'
  | 'analytics'
  | 'enrollments'
  | 'audit';
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
 * flag, cover with ImageCropper, categories, plans including the course,
 * publish/archive), Curriculum (`CourseCurriculum`), Promotions (course and
 * lesson multipliers; read-only for TEACHER), Translations, Analytics,
 * Enrollments (anonymised for TEACHER) and Audit. `?tab=` selects a tab.
 * Unsaved overview / cover / inline-form edits trigger the route guard.
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
    CourseAnalyticsTab,
    CourseAuditTab,
    CourseCurriculum,
    CourseEnrollmentsTab,
    CourseMultipliersTab,
    CourseTranslationsTab,
    EmptyState,
    FormField,
    Icon,
    ImageCropper,
    Input,
    LoadError,
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
          @for (t of tabs(); track t; let i = $index) {
            <button
              type="button"
              role="tab"
              [id]="'tab-' + t"
              [attr.aria-selected]="tab() === t"
              [attr.aria-controls]="'panel-' + t"
              [attr.tabindex]="tab() === t ? 0 : -1"
              (click)="selectTab(t)"
              (keydown)="onTabKey($event, i)"
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
                  @if (cropFile(); as file) {
                    <cdf-image-cropper
                      [file]="file"
                      [aspectRatio]="16 / 9"
                      [outputWidth]="1280"
                      outputType="image/jpeg"
                      (cropped)="uploadCropped($event)"
                    />
                    <div class="form-actions">
                      <cdf-button
                        kind="ghost"
                        size="sm"
                        [disabled]="busy() === 'crop'"
                        (click)="cropFile.set(null)"
                      >
                        {{ 'admin.common.cancel' | translate }}
                      </cdf-button>
                      @if (busy() === 'crop') {
                        <span class="muted small" aria-live="polite">{{
                          'admin.course.coverUploading' | translate
                        }}</span>
                      }
                    </div>
                  } @else {
                    <cdf-asset-picker
                      kind="COVER"
                      [(ngModel)]="cover"
                      [disabled]="!canEdit()"
                      [placeholder]="'admin.course.coverNone' | translate"
                    />
                    @if (canEdit()) {
                      <div class="form-actions">
                        <label
                          class="btn btn-sm btn-outline-secondary crop-pick"
                        >
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            class="visually-hidden"
                            (change)="pickCropFile($event)"
                            data-testid="cover-crop-input"
                          />
                          <cdf-icon name="crop" size="sm" />
                          {{ 'admin.course.cropNew' | translate }}
                        </label>
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
                      <p class="muted small">
                        {{ 'admin.course.cropHelp' | translate }}
                      </p>
                    }
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
              <cdf-course-curriculum
                [(course)]="courseModel"
                [canEdit]="canEdit()"
                [canEditLessons]="canEditLessons()"
              />
            </section>
          }
          @case ('promotions') {
            <section
              id="panel-promotions"
              role="tabpanel"
              aria-labelledby="tab-promotions"
              class="admin-card"
            >
              <cdf-course-multipliers-tab
                [courseId]="c.id"
                [manage]="canManagePromotions()"
              />
            </section>
          }
          @case ('translations') {
            <section
              id="panel-translations"
              role="tabpanel"
              aria-labelledby="tab-translations"
              class="admin-card"
            >
              <cdf-course-translations-tab [courseId]="c.id" [slug]="c.slug" />
            </section>
          }
          @case ('analytics') {
            <section
              id="panel-analytics"
              role="tabpanel"
              aria-labelledby="tab-analytics"
              class="admin-card"
            >
              <cdf-course-analytics-tab [courseId]="c.id" />
            </section>
          }
          @case ('enrollments') {
            <section
              id="panel-enrollments"
              role="tabpanel"
              aria-labelledby="tab-enrollments"
              class="admin-card"
            >
              <cdf-course-enrollments-tab [courseId]="c.id" />
            </section>
          }
          @case ('audit') {
            <section
              id="panel-audit"
              role="tabpanel"
              aria-labelledby="tab-audit"
              class="admin-card"
            >
              <cdf-course-audit-tab [courseId]="c.id" />
            </section>
          }
        }
      } @else if (loadError(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="retry()" />
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
      .crop-pick {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0;
      }
      .tabs {
        overflow-x: auto;
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
export class CourseDetailPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly courses = inject(CoursesClient);
  private readonly assets = inject(AssetsClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly plansClient = inject(PlansClient);
  private readonly toast = inject(ToastService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly curriculum = viewChild(CourseCurriculum);

  protected readonly editRoles = EDIT_ROLES.catalog;
  protected readonly statusVariant = statusVariant;
  protected readonly canEdit = computed(() =>
    this.auth.hasAnyRole(EDIT_ROLES.catalog),
  );
  protected readonly canEditLessons = computed(() =>
    canAccess('courseEditing', this.auth.role()),
  );
  protected readonly canManagePromotions = computed(() =>
    canAccess('promotions', this.auth.role()),
  );
  /** docs/04 Course tabs, filtered by role (§1). */
  protected readonly tabs = computed<Tab[]>(() =>
    courseTabsFor(this.auth.role()),
  );
  protected readonly tab = signal<Tab>('overview');

  protected readonly course = signal<CourseView | null>(null);
  protected readonly notFound = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly plans = signal<Plan[] | null>(null);

  protected form: OverviewForm = emptyForm();
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
  protected cover: AssetSummary | null = null;
  private initialCoverId: string | null = null;
  protected readonly cropFile = signal<File | null>(null);
  private readonly dirty = new DirtyTracker(() => this.form);
  private slug: string | null = null;

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

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => p.get('slug')),
        takeUntilDestroyed(),
      )
      .subscribe((slug) => {
        if (slug) void this.load(slug);
      });
    this.route.queryParamMap
      .pipe(
        map((p) => p.get('tab')),
        takeUntilDestroyed(),
      )
      .subscribe((t) => {
        if (t && (this.tabs() as string[]).includes(t)) this.tab.set(t as Tab);
      });
    void this.loadCategories();
  }

  /** Two-way binding target for the curriculum tab. */
  protected get courseModel(): CourseView {
    return this.course() as CourseView;
  }
  protected set courseModel(c: CourseView) {
    this.course.set(c);
  }

  hasUnsavedChanges(): boolean {
    return (
      this.dirty.isDirty() ||
      this.coverDirty ||
      !!this.cropFile() ||
      !!this.curriculum()?.hasUnsavedChanges()
    );
  }

  protected selectTab(t: Tab): void {
    this.tab.set(t);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: t === 'overview' ? null : t },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern). */
  protected onTabKey(ev: KeyboardEvent, i: number): void {
    const tabs = this.tabs();
    let next = -1;
    if (ev.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (ev.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    this.selectTab(tabs[next]);
    document.getElementById(`tab-${tabs[next]}`)?.focus();
  }

  protected get coverDirty(): boolean {
    return (this.cover?.id ?? null) !== this.initialCoverId;
  }

  protected retry(): void {
    if (this.slug) void this.load(this.slug);
  }

  private async load(slug: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.slug = slug;
    this.notFound.set(false);
    this.loadError.set(null);
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
        this.loadError.set(err);
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
    this.dirty.mark();
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
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories.set(
        (await this.categoriesClient.list({ take: 200 })).items,
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
      const keepCover = this.cover;
      const coverWasDirty = this.coverDirty;
      this.setCourse(fresh);
      if (coverWasDirty) this.cover = keepCover;
      if (fresh.slug !== this.slug) {
        this.slug = fresh.slug;
        void this.router.navigate(['/courses', fresh.slug], {
          replaceUrl: true,
          queryParamsHandling: 'preserve',
        });
      }
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

  // ─── Cover (ImageCropper + asset upload, docs/04 Overview) ────────────

  protected pickCropFile(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0] ?? null;
    el.value = '';
    if (file) this.cropFile.set(file);
  }

  protected async uploadCropped(img: CroppedImage): Promise<void> {
    this.busy.set('crop');
    try {
      const file = new File([img.blob], 'cover.jpg', {
        type: img.blob.type || 'image/jpeg',
      });
      const asset = await this.assets.upload(file, 'COVER');
      this.cover = toAssetSummary(asset);
      this.cropFile.set(null);
      this.toast.success(
        this.i18n.t(
          asset.deduplicated
            ? 'admin.course.coverDeduplicated'
            : 'admin.course.coverCropped',
        ),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
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
      const fresh = (await this.courses.detail(c.id)) as CourseView;
      // Keep unsaved overview edits: only status-derived fields change.
      this.course.set(fresh);
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
}

/** Tabs per role (docs/04 §1 + Course tabs). */
export function courseTabsFor(role: string | null | undefined): Tab[] {
  if (role === 'ADMIN' || role === 'TEACHER')
    return [
      'overview',
      'curriculum',
      'promotions',
      'translations',
      'analytics',
      'enrollments',
      'audit',
    ];
  if (role === 'SUPPORT') return ['overview', 'curriculum', 'audit'];
  return ['overview', 'curriculum'];
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
