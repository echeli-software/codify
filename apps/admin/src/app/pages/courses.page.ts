import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
} from '@codify/ui-bootstrap';
import {
  CoursesClient,
  type CourseListItem,
  type CourseStatus,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES } from '../core/roles';
import { SLUG_PATTERN, statusVariant } from '../core/catalog';

interface CreateForm {
  slug: string;
  title: string;
  description: string;
}

type CourseRow = CourseListItem;

const PAGE_SIZE = 25;
const EMPTY_FORM: CreateForm = { slug: '', title: '', description: '' };

/**
 * Courses list (docs/04 "Catalog → Courses"): status filter, server-side
 * pagination, "New course" draft form and per-row publish / archive /
 * delete. TEACHER sees only their own courses (server-enforced); SUPPORT
 * gets a read-only list.
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
    Pagination,
    Select,
    Textarea,
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
          (click)="openForm()"
          data-testid="new-course"
        >
          <cdf-icon name="plus" size="sm" />
          {{ 'admin.courses.new' | translate }}
        </cdf-button>
      </header>

      @if (formOpen()) {
        <section class="admin-card" aria-labelledby="new-course-title">
          <h2 id="new-course-title">{{ 'admin.courses.new' | translate }}</h2>
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
            >
              <cdf-textarea [(ngModel)]="form.description" [rows]="3" />
            </cdf-form-field>
          </div>
          <div class="form-actions">
            <cdf-button
              kind="primary"
              [loading]="saving()"
              (click)="save()"
              data-testid="create-course"
            >
              {{ 'admin.courses.createDraft' | translate }}
            </cdf-button>
            <cdf-button
              kind="ghost"
              [disabled]="saving()"
              (click)="closeForm()"
            >
              {{ 'admin.common.cancel' | translate }}
            </cdf-button>
          </div>
          @if (formError(); as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
        </section>
      }

      <div class="toolbar">
        <cdf-form-field
          [label]="'admin.common.status' | translate"
          controlId="course-status-filter"
        >
          <cdf-select
            inputId="course-status-filter"
            [options]="statusOptions()"
            [ngModel]="statusFilter()"
            (ngModelChange)="onStatusChange($event)"
          />
        </cdf-form-field>
        <p class="muted small" aria-live="polite">
          {{
            'admin.common.showing'
              | translate: { shown: rows().length, total: total() }
          }}
        </p>
      </div>

      @if (rows().length === 0 && !loading()) {
        <cdf-empty-state
          icon="search"
          [title]="'admin.courses.emptyTitle' | translate"
          [description]="'admin.courses.emptyDescription' | translate"
        />
      } @else {
        <cdf-data-table
          [rows]="rows()"
          [columns]="columns()"
          [emptyMessage]="'admin.common.loading' | translate"
        >
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
          <ng-template cdfDataTableCell="updatedAt" let-row>
            {{ row.updatedAt | locale: 'date' }}
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
        justify-content: space-between;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .title-link {
        font-weight: 600;
        margin-right: 6px;
      }
    `,
  ],
})
export class CoursesPage {
  private readonly client = inject(CoursesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly editRoles = EDIT_ROLES.catalog;
  protected readonly statusVariant = statusVariant;
  protected readonly statusFilter = signal<CourseStatus | ''>('');
  protected readonly rows = signal<readonly CourseRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );

  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected form: CreateForm = { ...EMPTY_FORM };
  protected slugTouched = false;
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
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

  protected readonly columns = computed<DataTableColumn<CourseRow>[]>(() => {
    this.i18n.currentLocale();
    const t = (k: string) => this.i18n.t(k);
    return [
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
        width: '160px',
      },
      {
        key: 'status',
        label: t('admin.common.status'),
        value: (r) => r.status,
        sortable: true,
        width: '120px',
      },
      {
        key: 'lessonCount',
        label: t('admin.courses.lessons'),
        value: (r) => r.lessonCount,
        sortable: true,
        width: '100px',
        align: 'end',
      },
      {
        key: 'updatedAt',
        label: t('admin.common.updatedAt'),
        value: (r) => r.updatedAt,
        sortable: true,
        width: '140px',
      },
      {
        key: 'actions',
        label: '',
        value: () => '',
        width: '200px',
        align: 'end',
      },
    ];
  });

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    const status = this.statusFilter() || undefined;
    try {
      const res = await this.client.list({
        status,
        skip: (this.page() - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      });
      if (seq !== this.loadSeq) return; // a newer filter/page won the race
      this.rows.set(res.items);
      this.total.set(res.total);
    } catch (err) {
      if (seq === this.loadSeq)
        this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected onStatusChange(value: CourseStatus | '' | null): void {
    this.statusFilter.set(value ?? '');
    this.page.set(1);
    void this.refresh();
  }

  protected goToPage(p: number): void {
    this.page.set(p);
    void this.refresh();
  }

  protected openForm(): void {
    this.form = { ...EMPTY_FORM };
    this.slugTouched = false;
    this.errors.set({});
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  /** Suggest a slug from the title until the author edits it. */
  protected onTitle(title: string): void {
    if (!this.slugTouched) this.form.slug = slugify(title);
  }

  protected async save(): Promise<void> {
    const errs: Record<string, string> = {};
    const slug = this.form.slug.trim();
    if (!this.form.title.trim())
      errs['title'] = this.i18n.t('admin.common.required');
    if (!slug) errs['slug'] = this.i18n.t('admin.common.required');
    else if (!SLUG_PATTERN.test(slug))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    this.errors.set(errs);
    if (Object.keys(errs).length) return;

    this.saving.set(true);
    this.formError.set(null);
    try {
      const created = await this.client.create({
        slug,
        title: this.form.title.trim(),
        description: this.form.description.trim() || undefined,
        sourceLocale: this.auth.user()?.locale ?? this.i18n.currentLocale(),
      });
      this.rows.update((rs) => [created, ...rs]);
      this.total.update((n) => n + 1);
      this.toast.success(
        this.i18n.t('admin.courses.created', { title: created.title }),
      );
      this.closeForm();
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

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

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}
