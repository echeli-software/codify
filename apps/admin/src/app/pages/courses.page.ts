import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService, RoleDirective } from '@codify/auth';
import {
  Badge,
  Button,
  ConfirmDialogService,
  DataTable,
  DataTableCell,
  type DataTableColumn,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  Pagination,
  Select,
  type SelectOption,
  Textarea,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  CategoriesClient,
  CoursesClient,
  ModulesClient,
  type BulkCourseAction,
  type Category,
  type CourseAuthor,
  type CourseListItem,
  type CourseStatus,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES } from '../core/roles';
import {
  SLUG_PATTERN,
  slugify,
  statusVariant,
  tokenColor,
} from '../core/catalog';
import { DirtyTracker } from '../core/dirty';
import { LoadError } from '../core/load-error';
import type { HasUnsavedChanges } from '../core/unsaved-changes';

type WizardStep = 'basics' | 'categories' | 'module';
const STEPS: readonly WizardStep[] = ['basics', 'categories', 'module'];

interface WizardForm {
  title: string;
  slug: string;
  description: string;
  difficulty: number;
  categoryIds: string[];
  moduleTitle: string;
}

type CourseRow = CourseListItem;

const PAGE_SIZE = 25;
const emptyWizard = (): WizardForm => ({
  title: '',
  slug: '',
  description: '',
  difficulty: 1,
  categoryIds: [],
  moduleTitle: '',
});

/**
 * Courses list (docs/04 "Catalog → Courses"): cover, title, author,
 * status, category chips, lessons and published date; filters for status,
 * category, author and "has missing translations"; bulk publish / archive /
 * change category (audited server-side); and the "+ New course" wizard
 * (basics → categories → first module). TEACHER sees only own courses
 * (server-enforced); SUPPORT gets a read-only list.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    RoleDirective,
    Badge,
    Button,
    DataTable,
    DataTableCell,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    LoadError,
    Pagination,
    Select,
    Textarea,
    Toggle,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.courses.title' | translate }}</h1>
          <p class="muted">{{ 'admin.courses.subtitle' | translate }}</p>
        </div>
        <cdf-button
          *codifyIfRole="editRoles"
          kind="primary"
          (click)="openWizard()"
          data-testid="new-course"
        >
          <cdf-icon name="plus" size="sm" />
          {{ 'admin.courses.new' | translate }}
        </cdf-button>
      </header>

      @if (wizardOpen()) {
        <section
          class="admin-card wizard"
          aria-labelledby="new-course-title"
          data-testid="course-wizard"
        >
          <h2 id="new-course-title">{{ 'admin.courses.new' | translate }}</h2>
          <ol
            class="steps"
            [attr.aria-label]="'admin.courses.wizard.steps' | translate"
          >
            @for (s of steps; track s; let i = $index) {
              <li
                [class.active]="step() === s"
                [class.done]="stepIndex() > i"
                [attr.aria-current]="step() === s ? 'step' : null"
              >
                <span class="num">{{ i + 1 }}</span>
                {{ 'admin.courses.wizard.' + s | translate }}
              </li>
            }
          </ol>

          @switch (step()) {
            @case ('basics') {
              <div class="form-grid form-grid--2">
                <cdf-form-field
                  [label]="'admin.courses.fields.title' | translate"
                  controlId="course-title"
                  [required]="true"
                  [error]="errors()['title'] ?? null"
                >
                  <cdf-input
                    inputId="course-title"
                    [(ngModel)]="form.title"
                    (ngModelChange)="onTitle($event)"
                    [invalid]="!!errors()['title']"
                  />
                </cdf-form-field>
                <cdf-form-field
                  [label]="'admin.common.slug' | translate"
                  [help]="'admin.courses.fields.slugHelp' | translate"
                  controlId="course-slug"
                  [required]="true"
                  [error]="errors()['slug'] ?? null"
                >
                  <cdf-input
                    inputId="course-slug"
                    [(ngModel)]="form.slug"
                    (ngModelChange)="slugTouched = true"
                    [invalid]="!!errors()['slug']"
                  />
                </cdf-form-field>
                <cdf-form-field
                  class="span-all"
                  [label]="'admin.common.description' | translate"
                  controlId="course-desc"
                >
                  <cdf-textarea [(ngModel)]="form.description" [rows]="3" />
                </cdf-form-field>
                <cdf-form-field
                  [label]="'admin.course.difficulty' | translate"
                  [help]="'admin.course.difficultyHelp' | translate"
                  controlId="course-difficulty"
                >
                  <cdf-input
                    inputId="course-difficulty"
                    type="number"
                    [(ngModel)]="form.difficulty"
                  />
                </cdf-form-field>
              </div>
            }
            @case ('categories') {
              <cdf-form-field
                [label]="'admin.course.categories' | translate"
                [help]="'admin.courses.wizard.categoriesHelp' | translate"
                controlId="course-cats"
              >
                <cdf-select
                  inputId="course-cats"
                  [multiple]="true"
                  [options]="categoryOptions()"
                  [(ngModel)]="form.categoryIds"
                />
              </cdf-form-field>
            }
            @case ('module') {
              <cdf-form-field
                [label]="'admin.course.moduleTitle' | translate"
                [help]="'admin.courses.wizard.moduleHelp' | translate"
                controlId="course-module"
              >
                <cdf-input
                  inputId="course-module"
                  [(ngModel)]="form.moduleTitle"
                />
              </cdf-form-field>
            }
          }

          <div class="form-actions">
            @if (stepIndex() > 0) {
              <cdf-button
                kind="secondary"
                [disabled]="saving()"
                (click)="back()"
              >
                {{ 'admin.courses.wizard.back' | translate }}
              </cdf-button>
            }
            @if (step() !== 'module') {
              <cdf-button
                kind="primary"
                (click)="next()"
                data-testid="wizard-next"
              >
                {{ 'admin.courses.wizard.next' | translate }}
              </cdf-button>
            } @else {
              <cdf-button
                kind="primary"
                [loading]="saving()"
                (click)="save()"
                data-testid="create-course"
              >
                {{ 'admin.courses.createDraft' | translate }}
              </cdf-button>
            }
            <cdf-button
              kind="ghost"
              [disabled]="saving()"
              (click)="closeWizard()"
            >
              {{ 'admin.common.cancel' | translate }}
            </cdf-button>
          </div>
          @if (formError(); as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
        </section>
      }

      <div class="toolbar" role="search">
        <cdf-form-field
          [label]="'admin.common.status' | translate"
          controlId="course-status-filter"
        >
          <cdf-select
            inputId="course-status-filter"
            [options]="statusOptions()"
            [ngModel]="statusFilter()"
            (ngModelChange)="setFilter(statusFilter, $event ?? '')"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.course.categories' | translate"
          controlId="course-category-filter"
        >
          <cdf-select
            inputId="course-category-filter"
            [options]="categoryFilterOptions()"
            [ngModel]="categoryFilter()"
            (ngModelChange)="setFilter(categoryFilter, $event ?? '')"
          />
        </cdf-form-field>
        @if (!isTeacher()) {
          <cdf-form-field
            [label]="'admin.courses.author' | translate"
            controlId="course-author-filter"
          >
            <cdf-select
              inputId="course-author-filter"
              [options]="authorOptions()"
              [ngModel]="authorFilter()"
              (ngModelChange)="setFilter(authorFilter, $event ?? '')"
            />
          </cdf-form-field>
        }
        <cdf-toggle
          [ngModel]="missingOnly()"
          (ngModelChange)="setFilter(missingOnly, !!$event)"
          [label]="'admin.courses.missingTranslations' | translate"
          data-testid="filter-missing-translations"
        />
        <p class="muted small" aria-live="polite">
          {{
            'admin.common.showing'
              | translate: { shown: rows().length, total: total() }
          }}
        </p>
      </div>

      @if (selectedIds().length > 0 && canEdit()) {
        <div
          class="bulk-bar"
          role="region"
          [attr.aria-label]="'admin.courses.bulk.label' | translate"
          data-testid="bulk-bar"
        >
          <strong>{{
            'admin.courses.bulk.selected'
              | translate: { count: selectedIds().length }
          }}</strong>
          <cdf-button
            size="sm"
            kind="primary"
            [loading]="bulkBusy() === 'publish'"
            (click)="bulk('publish')"
          >
            {{ 'admin.courses.publish' | translate }}
          </cdf-button>
          <cdf-button
            size="sm"
            kind="secondary"
            [loading]="bulkBusy() === 'archive'"
            (click)="bulk('archive')"
          >
            {{ 'admin.courses.archive' | translate }}
          </cdf-button>
          <span class="bulk-cats">
            <cdf-select
              size="sm"
              [multiple]="true"
              [options]="categoryOptions()"
              [(ngModel)]="bulkCategoryIds"
              [ariaLabel]="'admin.courses.bulk.categories' | translate"
            />
            <cdf-button
              size="sm"
              kind="secondary"
              [loading]="bulkBusy() === 'setCategories'"
              (click)="bulk('setCategories')"
            >
              {{ 'admin.courses.bulk.setCategories' | translate }}
            </cdf-button>
          </span>
          <cdf-button size="sm" kind="ghost" (click)="clearSelection()">
            {{ 'admin.courses.bulk.clear' | translate }}
          </cdf-button>
        </div>
      }

      @if (loadError(); as err) {
        <cdf-admin-load-error [error]="err" (retry)="refresh()" />
      } @else if (rows().length === 0 && !loading()) {
        <cdf-empty-state
          icon="search"
          [title]="
            (filtered()
              ? 'admin.courses.noMatchTitle'
              : 'admin.courses.emptyTitle'
            ) | translate
          "
          [description]="
            (filtered()
              ? 'admin.courses.noMatchDescription'
              : 'admin.courses.emptyDescription'
            ) | translate
          "
        >
          @if (filtered()) {
            <cdf-button kind="secondary" (click)="resetFilters()">
              {{ 'admin.courses.resetFilters' | translate }}
            </cdf-button>
          } @else {
            <cdf-button
              *codifyIfRole="editRoles"
              kind="primary"
              (click)="openWizard()"
            >
              <cdf-icon name="plus" size="sm" />
              {{ 'admin.courses.new' | translate }}
            </cdf-button>
          }
        </cdf-empty-state>
      } @else {
        <cdf-data-table
          [rows]="rows()"
          [columns]="columns()"
          [selectable]="canEdit()"
          (selectionChange)="selectedIds.set($any($event))"
          [emptyMessage]="'admin.common.loading' | translate"
        >
          <ng-template cdfDataTableCell="cover" let-row>
            @if (row.coverUrl) {
              <img
                class="cover"
                [src]="row.coverUrl"
                alt=""
                width="64"
                height="36"
                loading="lazy"
              />
            } @else {
              <span class="cover cover--none" aria-hidden="true"
                ><cdf-icon name="image" size="sm"
              /></span>
            }
          </ng-template>
          <ng-template cdfDataTableCell="title" let-row>
            <a [routerLink]="['/courses', row.slug]" class="title-link">{{
              row.title
            }}</a>
            @if (row.isCapstone) {
              <cdf-badge variant="premium" [subtle]="true">{{
                'admin.courses.capstone' | translate
              }}</cdf-badge>
            }
          </ng-template>
          <ng-template cdfDataTableCell="status" let-row>
            <cdf-badge [variant]="statusVariant(row.status)" [subtle]="true">
              {{ 'admin.courseStatus.' + row.status | translate }}
            </cdf-badge>
          </ng-template>
          <ng-template cdfDataTableCell="categories" let-row>
            <span class="chip-row">
              @for (c of categoriesOf(row); track c.id) {
                <span class="cat-chip">
                  <span
                    class="dot"
                    [style.background]="
                      tokenColor(c.colorToken) ?? 'var(--cdf-color-border)'
                    "
                    aria-hidden="true"
                  ></span>
                  {{ c.name }}
                </span>
              } @empty {
                <span class="muted small">{{
                  'admin.common.none' | translate
                }}</span>
              }
            </span>
          </ng-template>
          <ng-template cdfDataTableCell="publishedAt" let-row>
            @if (row.publishedAt) {
              {{ row.publishedAt | locale: 'date' }}
            } @else {
              <span class="muted small">{{
                'admin.courses.notPublished' | translate
              }}</span>
            }
          </ng-template>
          <ng-template cdfDataTableCell="actions" let-row>
            <div class="row-actions" *codifyIfRole="editRoles">
              @if (row.status === 'DRAFT') {
                <cdf-button
                  kind="primary"
                  size="sm"
                  [loading]="busyId() === row.id"
                  (click)="publishRow(row)"
                >
                  {{ 'admin.courses.publish' | translate }}
                </cdf-button>
              } @else if (row.status === 'PUBLISHED') {
                <cdf-button
                  kind="secondary"
                  size="sm"
                  [loading]="busyId() === row.id"
                  (click)="archiveRow(row)"
                >
                  {{ 'admin.courses.archive' | translate }}
                </cdf-button>
              }
              <cdf-icon-button
                icon="trash"
                [ariaLabel]="
                  'admin.courses.deleteAria' | translate: { title: row.title }
                "
                size="sm"
                kind="danger"
                (click)="deleteRow(row)"
              />
            </div>
          </ng-template>
        </cdf-data-table>
        @if (totalPages() > 1) {
          <cdf-pagination
            [page]="page()"
            [totalPages]="totalPages()"
            (pageChange)="goToPage($event)"
          />
        }
      }
    </div>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .toolbar > p {
        margin-left: auto;
      }
      .title-link {
        font-weight: 600;
        margin-right: 6px;
      }
      .cover {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 36px;
        object-fit: cover;
        border-radius: var(--cdf-radius-sm);
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-bg);
        color: var(--cdf-color-text-subtle);
      }
      .cat-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 8px;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-pill);
        font-size: 12px;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .bulk-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2) var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
        border: 1px solid var(--cdf-color-primary);
        border-radius: var(--cdf-radius-md);
        background: var(--cdf-color-primary-subtle);
      }
      .bulk-cats {
        display: inline-flex;
        gap: var(--cdf-space-2);
        align-items: center;
        min-width: 220px;
      }
      .steps {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-3);
        list-style: none;
        padding: 0;
        margin: 0 0 var(--cdf-space-4);
        li {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--cdf-color-text-muted);
        }
        li.active {
          color: var(--cdf-color-text);
          font-weight: 600;
        }
        .num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1px solid currentColor;
          font-size: 12px;
        }
        li.active .num,
        li.done .num {
          background: var(--cdf-color-primary);
          border-color: var(--cdf-color-primary);
          color: var(--cdf-color-primary-on);
        }
      }
    `,
  ],
})
export class CoursesPage implements HasUnsavedChanges {
  private readonly client = inject(CoursesClient);
  private readonly admin = inject(AdminCatalogClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly modulesClient = inject(ModulesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly table = viewChild(DataTable);

  protected readonly editRoles = EDIT_ROLES.catalog;
  protected readonly statusVariant = statusVariant;
  protected readonly tokenColor = tokenColor;
  protected readonly steps = STEPS;
  protected readonly canEdit = computed(() =>
    this.auth.hasAnyRole(EDIT_ROLES.catalog),
  );
  protected readonly isTeacher = computed(() => this.auth.role() === 'TEACHER');

  protected readonly statusFilter = signal<CourseStatus | ''>('');
  protected readonly categoryFilter = signal<string>('');
  protected readonly authorFilter = signal<string>('');
  protected readonly missingOnly = signal(false);
  protected readonly filtered = computed(
    () =>
      !!this.statusFilter() ||
      !!this.categoryFilter() ||
      !!this.authorFilter() ||
      this.missingOnly(),
  );

  protected readonly rows = signal<readonly CourseRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly authors = signal<CourseAuthor[]>([]);
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly bulkBusy = signal<BulkCourseAction | null>(null);
  protected bulkCategoryIds: string[] = [];
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );

  protected readonly wizardOpen = signal(false);
  protected readonly step = signal<WizardStep>('basics');
  protected readonly stepIndex = computed(() => STEPS.indexOf(this.step()));
  protected readonly saving = signal(false);
  protected form: WizardForm = emptyWizard();
  protected slugTouched = false;
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
  private readonly dirty = new DirtyTracker(() => this.form);
  private loadSeq = 0;

  protected readonly statusOptions = computed<
    SelectOption<CourseStatus | ''>[]
  >(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.courses.allStatuses') },
      ...(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).map((s) => ({
        value: s,
        label: this.i18n.t(`admin.courseStatus.${s}`),
      })),
    ];
  });
  protected readonly categoryOptions = computed<SelectOption<string>[]>(() =>
    this.categories().map((c) => ({ value: c.id, label: c.name })),
  );
  protected readonly categoryFilterOptions = computed<SelectOption<string>[]>(
    () => {
      this.i18n.currentLocale();
      return [
        { value: '', label: this.i18n.t('admin.courses.allCategories') },
        ...this.categoryOptions(),
      ];
    },
  );
  protected readonly authorOptions = computed<SelectOption<string>[]>(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.courses.allAuthors') },
      ...this.authors().map((a) => ({ value: a.id, label: a.displayName })),
    ];
  });
  private readonly categoryById = computed(
    () => new Map(this.categories().map((c) => [c.id, c])),
  );

  protected readonly columns = computed<DataTableColumn<CourseRow>[]>(() => {
    this.i18n.currentLocale();
    const t = (k: string) => this.i18n.t(k);
    return [
      {
        key: 'cover',
        label: t('admin.courses.cover'),
        value: () => '',
        width: '80px',
      },
      {
        key: 'title',
        label: t('admin.courses.fields.title'),
        value: (r) => r.title,
        sortable: true,
      },
      {
        key: 'authorDisplayName',
        label: t('admin.courses.author'),
        value: (r) => r.authorDisplayName,
        sortable: true,
        width: '140px',
      },
      {
        key: 'status',
        label: t('admin.common.status'),
        value: (r) => r.status,
        sortable: true,
        width: '110px',
      },
      {
        key: 'categories',
        label: t('admin.course.categories'),
        value: (r) => r.categoryIds.length,
      },
      {
        key: 'lessonCount',
        label: t('admin.courses.lessons'),
        value: (r) => r.lessonCount,
        sortable: true,
        width: '90px',
        align: 'end',
      },
      {
        key: 'publishedAt',
        label: t('admin.courses.publishedAt'),
        value: (r) => r.publishedAt ?? '',
        sortable: true,
        width: '130px',
      },
      {
        key: 'actions',
        label: '',
        value: () => '',
        width: '180px',
        align: 'end',
      },
    ];
  });

  constructor() {
    void this.refresh();
    void this.loadFilters();
  }

  hasUnsavedChanges(): boolean {
    return this.wizardOpen() && this.dirty.isDirty();
  }

  protected categoriesOf(row: CourseRow): Category[] {
    const by = this.categoryById();
    return row.categoryIds
      .map((id) => by.get(id))
      .filter((c): c is Category => !!c);
  }

  private async loadFilters(): Promise<void> {
    try {
      const [cats, authors] = await Promise.all([
        this.categoriesClient.list({ take: 200 }),
        this.isTeacher() ? Promise.resolve([]) : this.admin.courseAuthors(),
      ]);
      this.categories.set(cats.items);
      this.authors.set(authors);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async refresh(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const res = await this.admin.listCourses({
        status: this.statusFilter() || undefined,
        categoryId: this.categoryFilter() || undefined,
        authorId: this.authorFilter() || undefined,
        missingTranslations: this.missingOnly() || undefined,
        skip: (this.page() - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      });
      if (seq !== this.loadSeq) return; // a newer filter/page won the race
      this.rows.set(res.items);
      this.total.set(res.total);
    } catch (err) {
      if (seq === this.loadSeq) {
        this.rows.set([]);
        this.loadError.set(err);
      }
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected setFilter<T>(target: { set(v: T): void }, value: T): void {
    target.set(value);
    this.page.set(1);
    this.clearSelection();
    void this.refresh();
  }

  protected resetFilters(): void {
    this.statusFilter.set('');
    this.categoryFilter.set('');
    this.authorFilter.set('');
    this.missingOnly.set(false);
    this.page.set(1);
    void this.refresh();
  }

  protected goToPage(p: number): void {
    this.page.set(p);
    this.clearSelection();
    void this.refresh();
  }

  protected clearSelection(): void {
    this.table()?.selected.set(new Set());
    this.selectedIds.set([]);
  }

  // ─── Bulk ─────────────────────────────────────────────────────────────

  protected async bulk(action: BulkCourseAction): Promise<void> {
    const ids = this.selectedIds();
    if (!ids.length) return;
    const ok = await this.confirm.open({
      title: this.i18n.t(`admin.courses.bulk.confirm.${action}`, {
        count: ids.length,
      }),
      message: this.i18n.t('admin.courses.bulk.confirmMessage'),
      confirmLabel: this.i18n.t('admin.courses.bulk.apply'),
    });
    if (!ok) return;
    this.bulkBusy.set(action);
    try {
      const res = await this.admin.bulkCourses({
        ids,
        action,
        categoryIds:
          action === 'setCategories' ? this.bulkCategoryIds : undefined,
      });
      if (res.failed.length)
        this.toast.error(
          this.i18n.t('admin.courses.bulk.partial', {
            ok: res.updated.length,
            failed: res.failed.length,
          }),
        );
      else
        this.toast.success(
          this.i18n.t('admin.courses.bulk.done', { count: res.updated.length }),
        );
      this.clearSelection();
      await this.refresh();
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.bulkBusy.set(null);
    }
  }

  // ─── Wizard ───────────────────────────────────────────────────────────

  protected openWizard(): void {
    this.form = emptyWizard();
    this.slugTouched = false;
    this.errors.set({});
    this.formError.set(null);
    this.step.set('basics');
    this.wizardOpen.set(true);
    this.dirty.mark();
  }

  protected async closeWizard(): Promise<void> {
    if (this.dirty.isDirty()) {
      const ok = await this.confirm.open({
        title: this.i18n.t('admin.unsaved.title'),
        message: this.i18n.t('admin.unsaved.message'),
        confirmLabel: this.i18n.t('admin.unsaved.leave'),
        cancelLabel: this.i18n.t('admin.unsaved.stay'),
        confirmKind: 'danger',
        icon: 'warning',
      });
      if (!ok) return;
    }
    this.dirty.clear();
    this.wizardOpen.set(false);
  }

  /** Suggest a slug from the title until the author edits it. */
  protected onTitle(title: string): void {
    if (!this.slugTouched) this.form.slug = slugify(title);
  }

  private validateBasics(): boolean {
    const errs: Record<string, string> = {};
    const slug = this.form.slug.trim();
    if (!this.form.title.trim())
      errs['title'] = this.i18n.t('admin.common.required');
    if (!slug) errs['slug'] = this.i18n.t('admin.common.required');
    else if (!SLUG_PATTERN.test(slug))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    this.errors.set(errs);
    return Object.keys(errs).length === 0;
  }

  protected next(): void {
    if (this.step() === 'basics' && !this.validateBasics()) return;
    this.step.set(STEPS[Math.min(STEPS.length - 1, this.stepIndex() + 1)]);
  }

  protected back(): void {
    this.step.set(STEPS[Math.max(0, this.stepIndex() - 1)]);
  }

  protected async save(): Promise<void> {
    if (!this.validateBasics()) {
      this.step.set('basics');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    try {
      const created = await this.client.create({
        slug: this.form.slug.trim(),
        title: this.form.title.trim(),
        description: this.form.description.trim() || undefined,
        difficulty: Math.min(
          5,
          Math.max(1, Math.round(Number(this.form.difficulty) || 1)),
        ),
        categoryIds: this.form.categoryIds,
        sourceLocale: this.auth.user()?.locale ?? this.i18n.currentLocale(),
      });
      const moduleTitle = this.form.moduleTitle.trim();
      if (moduleTitle) {
        try {
          await this.modulesClient.create(created.id, { title: moduleTitle });
        } catch (err) {
          // The course exists; the module can be added from the curriculum.
          this.errorsSvc.toast(err, 'admin.errors.saveFailed');
        }
      }
      this.toast.success(
        this.i18n.t('admin.courses.created', { title: created.title }),
      );
      this.dirty.clear();
      this.wizardOpen.set(false);
      void this.router.navigate(['/courses', created.slug], {
        queryParams: { tab: 'curriculum' },
      });
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  // ─── Row actions ──────────────────────────────────────────────────────

  protected async publishRow(row: CourseRow): Promise<void> {
    await this.rowAction(row, () => this.client.publish(row.id), 'published');
  }

  protected async archiveRow(row: CourseRow): Promise<void> {
    await this.rowAction(row, () => this.client.archive(row.id), 'archived');
  }

  private async rowAction(
    row: CourseRow,
    fn: () => Promise<CourseListItem>,
    msg: 'published' | 'archived',
  ): Promise<void> {
    this.busyId.set(row.id);
    try {
      const updated = await fn();
      this.rows.update((rs) =>
        rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
      this.toast.success(
        this.i18n.t(`admin.courses.${msg}`, { title: updated.title }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busyId.set(null);
    }
  }

  protected async deleteRow(row: CourseRow): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', {
        name: row.title,
      }),
      message: this.i18n.t('admin.courses.deleteMessage', { slug: row.slug }),
      confirmKind: 'danger',
      confirmLabel: this.i18n.t('admin.common.delete'),
      icon: 'trash',
      typeToConfirm: row.slug,
    });
    if (!ok) return;
    try {
      await this.client.remove(row.id);
      this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
      this.total.update((n) => Math.max(0, n - 1));
      this.toast.success(
        this.i18n.t('admin.courses.deleted', { title: row.title }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }
}
