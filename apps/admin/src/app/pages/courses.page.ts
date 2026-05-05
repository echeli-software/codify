import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
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
  Select,
  type SelectOption,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  CoursesClient,
  ProblemDetailsError,
  type CourseListItem,
  type CourseStatus,
} from '@codify/api-client';

interface CreateForm {
  slug: string;
  title: string;
  description: string;
}

const EMPTY_FORM: CreateForm = { slug: '', title: '', description: '' };

const STATUS_OPTIONS: SelectOption<CourseStatus | 'ALL'>[] = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
];

/**
 * Admin Courses list — replaces the static demo with /api/courses.
 *
 * Status filter scopes the query, "New course" creates a DRAFT, row
 * actions Publish / Archive / Delete each map to the matching API
 * endpoint. TEACHER role only sees their own courses (server-enforced).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    BreadcrumbBar,
    Button,
    DataTable,
    DataTableCell,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    Select,
  ],
  template: `
    <cdf-breadcrumb-bar [crumbs]="crumbs" />

    <header class="page-head">
      <div>
        <h1>Courses</h1>
        <p class="muted">Manage published and draft courses across the catalog.</p>
      </div>
      <cdf-button kind="primary" (click)="openForm()">
        <cdf-icon name="plus" size="sm" /> New course
      </cdf-button>
    </header>

    <div class="page-toolbar">
      <cdf-form-field label="Status" style="max-width: 220px;">
        <cdf-select
          [options]="statusOptions"
          [ngModel]="statusFilter()"
          (ngModelChange)="onStatusChange($event)"
        />
      </cdf-form-field>
      <p class="muted small toolbar-meta">
        Showing {{ rows().length }} of {{ total() }} courses
      </p>
    </div>

    @if (formOpen()) {
    <section class="card form-card">
      <h3>New course</h3>
      <cdf-form-field label="Title" [error]="errors()['title'] ?? null">
        <cdf-input
          [(ngModel)]="formInputs.title"
          (ngModelChange)="onField('title', $event)"
          placeholder="React Fundamentals"
        />
      </cdf-form-field>
      <cdf-form-field
        label="Slug"
        hint="Kebab-case identifier."
        [error]="errors()['slug'] ?? null"
      >
        <cdf-input
          [(ngModel)]="formInputs.slug"
          (ngModelChange)="onField('slug', $event)"
          placeholder="react-fundamentals"
        />
      </cdf-form-field>
      <cdf-form-field label="Description (optional)">
        <cdf-input
          [(ngModel)]="formInputs.description"
          (ngModelChange)="onField('description', $event)"
          placeholder="Hooks, state, and rendering — the modern foundations."
        />
      </cdf-form-field>
      <div class="form-actions">
        <cdf-button kind="primary" [loading]="saving()" (click)="save()">
          Create draft
        </cdf-button>
        <cdf-button kind="ghost" (click)="closeForm()" [disabled]="saving()">
          Cancel
        </cdf-button>
      </div>
      @if (formError()) {
      <p class="form-error">{{ formError() }}</p>
      }
    </section>
    }

    @if (rows().length === 0 && !loading()) {
    <cdf-empty-state
      icon="search"
      title="No courses yet"
      description="Click 'New course' to create your first draft."
    />
    } @else {
    <cdf-data-table [rows]="rows()" [columns]="columns">
      <ng-template cdfDataTableCell="title" let-row>
        <a [routerLink]="['/courses', row.slug]" class="title-link">{{ row.title }}</a>
        @if (row.titleFromTranslation) {
        <cdf-icon name="translate" size="xs" />
        }
      </ng-template>
      <ng-template cdfDataTableCell="status" let-row>
        <cdf-badge [variant]="statusVariant(row.status)" [subtle]="true">
          {{ row.status }}
        </cdf-badge>
      </ng-template>
      <ng-template cdfDataTableCell="actions" let-row>
        <div class="row-actions">
          @if (row.status === 'DRAFT') {
          <cdf-button
            kind="primary"
            size="sm"
            [loading]="busyId() === row.id"
            (click)="publishRow(row)"
          >
            Publish
          </cdf-button>
          } @else if (row.status === 'PUBLISHED') {
          <cdf-button
            kind="secondary"
            size="sm"
            [loading]="busyId() === row.id"
            (click)="archiveRow(row)"
          >
            Archive
          </cdf-button>
          }
          <cdf-icon-button
            icon="trash"
            ariaLabel="Delete"
            size="sm"
            kind="danger"
            (click)="deleteRow(row)"
          />
        </div>
      </ng-template>
    </cdf-data-table>
    }
  `,
  styles: [
    `
      :host { display: block; max-width: 1180px; margin: 0 auto; }
      .page-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cdf-space-3);
        margin: var(--cdf-space-3) 0;
        h1 { margin: 0; }
      }
      .muted { color: var(--cdf-color-text-muted); margin: 0; }
      .small { font-size: 13px; }
      .page-toolbar {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .toolbar-meta { margin-left: auto; }
      .card {
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-4);
        margin-bottom: var(--cdf-space-4);
      }
      .form-card h3 { margin: 0 0 var(--cdf-space-3); }
      .form-actions {
        display: flex;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-3);
      }
      .form-error {
        margin-top: var(--cdf-space-2);
        color: var(--cdf-color-danger);
        font-size: 13px;
      }
      .title-link {
        font-weight: 600;
        text-decoration: none;
        color: var(--cdf-color-primary);
      }
      .title-link:hover { text-decoration: underline; }
      .row-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
    `,
  ],
})
export class CoursesPage {
  private readonly client = inject(CoursesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly crumbs: BreadcrumbCrumb[] = [
    { label: 'Catalog', routerLink: ['/'] },
    { label: 'Courses' },
  ];

  protected readonly statusFilter = signal<CourseStatus | 'ALL'>('ALL');
  protected readonly rows = signal<readonly CourseListItem[]>([]);
  protected readonly total = signal<number>(0);
  protected readonly loading = signal<boolean>(false);
  protected readonly busyId = signal<string | null>(null);

  protected readonly formOpen = signal<boolean>(false);
  protected readonly saving = signal<boolean>(false);
  protected formInputs: CreateForm = { ...EMPTY_FORM };
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);

  protected readonly columns: DataTableColumn<CourseListItem>[] = [
    { key: 'title', label: 'Title', value: (r) => r.title, sortable: true },
    {
      key: 'authorDisplayName',
      label: 'Author',
      value: (r) => r.authorDisplayName,
      sortable: true,
      width: '160px',
    },
    {
      key: 'status',
      label: 'Status',
      value: (r) => r.status,
      sortable: true,
      width: '120px',
    },
    {
      key: 'moduleCount',
      label: 'Modules',
      value: (r) => r.moduleCount,
      sortable: true,
      width: '110px',
      align: 'end',
    },
    {
      key: 'updatedAt',
      label: 'Updated',
      value: (r) => r.updatedAt,
      sortable: true,
      width: '160px',
    },
    { key: 'actions', label: '', value: () => '', width: '200px', align: 'end' },
  ];

  constructor() {
    effect(() => {
      const status = this.statusFilter();
      void this.refresh(status === 'ALL' ? undefined : status);
    });
  }

  private async refresh(status?: CourseStatus): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.client.list({ status, take: 200 });
      this.rows.set(res.items);
      this.total.set(res.total);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Failed to load courses'));
    } finally {
      this.loading.set(false);
    }
  }

  protected onStatusChange(value: CourseStatus | 'ALL' | null): void {
    if (value) this.statusFilter.set(value);
  }

  protected statusVariant(
    status: CourseListItem['status'],
  ): 'success' | 'warning' | 'neutral' {
    if (status === 'PUBLISHED') return 'success';
    if (status === 'DRAFT') return 'warning';
    return 'neutral';
  }

  protected openForm(): void {
    this.formInputs = { ...EMPTY_FORM };
    this.errors.set({});
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected onField(field: keyof CreateForm, value: string): void {
    this.formInputs = { ...this.formInputs, [field]: value };
    if (this.errors()[field]) {
      this.errors.update((e) => ({ ...e, [field]: undefined }));
    }
  }

  protected async save(): Promise<void> {
    const errs = validateCreate(this.formInputs);
    if (Object.keys(errs).length > 0) {
      this.errors.set(errs);
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    try {
      const created = await this.client.create({
        slug: this.formInputs.slug.trim(),
        title: this.formInputs.title.trim(),
        description: this.formInputs.description.trim() || undefined,
      });
      this.rows.update((rs) => [created, ...rs]);
      this.total.update((n) => n + 1);
      this.toast.success(`Course "${created.title}" drafted`);
      this.closeForm();
    } catch (err) {
      this.formError.set(this.describeError(err, 'Save failed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async publishRow(row: CourseListItem): Promise<void> {
    this.busyId.set(row.id);
    try {
      const updated = await this.client.publish(row.id);
      this.rows.update((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      this.toast.success(`Published "${updated.title}"`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Publish failed'));
    } finally {
      this.busyId.set(null);
    }
  }

  protected async archiveRow(row: CourseListItem): Promise<void> {
    this.busyId.set(row.id);
    try {
      const updated = await this.client.archive(row.id);
      this.rows.update((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      this.toast.success(`Archived "${updated.title}"`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Archive failed'));
    } finally {
      this.busyId.set(null);
    }
  }

  protected async deleteRow(row: CourseListItem): Promise<void> {
    const ok = await this.confirm.open({
      title: `Delete "${row.title}"?`,
      message: 'The course will be soft-deleted and disappear from the catalog.',
      confirmKind: 'danger',
      confirmLabel: 'Delete',
      icon: 'trash',
      typeToConfirm: row.slug,
    });
    if (!ok) return;
    try {
      await this.client.remove(row.id);
      this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
      this.total.update((n) => Math.max(0, n - 1));
      this.toast.success(`Deleted "${row.title}"`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Delete failed'));
    }
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isUnauthorized) return 'You are signed out. Please sign in again.';
      if (err.isForbidden) return 'You do not have permission for that action.';
      if (err.status === 409) return 'A course with that slug already exists.';
      if (err.message) return err.message;
    }
    return fallback;
  }
}

function validateCreate(f: CreateForm): Record<string, string> {
  const errs: Record<string, string> = {};
  const slug = f.slug.trim();
  if (!slug) errs['slug'] = 'Required';
  else if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug))
    errs['slug'] = 'Use kebab-case: a-z, 0-9, hyphens.';
  if (!f.title.trim()) errs['title'] = 'Required';
  return errs;
}
