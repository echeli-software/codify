import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Button,
  ConfirmDialogService,
  DataTable,
  DataTableCell,
  type DataTableColumn,
  EmptyState,
  FormField,
  Icon,
  Input,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  CategoriesClient,
  ProblemDetailsError,
  type Category,
} from '@codify/api-client';

interface FormState {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  iconName: string;
  colorToken: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  slug: '',
  name: '',
  description: '',
  iconName: '',
  colorToken: '',
};

/**
 * Admin Categories CRUD. List on the left, create/edit form on the right
 * (collapsing to stacked on narrow screens). The catalog list is also
 * the source of truth for the student-facing filter chips, so changes
 * here propagate to /api/categories which Phase 5e wires into the
 * student catalog.
 *
 * Soft-delete only — `deletedAt` flag is set, the row stays in the
 * audit history and any future "restore" feature can flip it back. That
 * matches the docs/04 §"Course archive" pattern even though it's
 * currently scoped to categories.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    DataTable,
    DataTableCell,
    EmptyState,
    FormField,
    Icon,
    Input,
  ],
  template: `
    <header class="page-header">
      <div>
        <h1>Categories</h1>
        <p class="text-muted">
          Taxonomy used to tag courses + filter the student catalog.
        </p>
      </div>
      <cdf-button kind="primary" (click)="startCreate()">
        <cdf-icon name="plus" size="sm" /> New category
      </cdf-button>
    </header>

    <div class="grid">
      <section class="card">
        <h3>{{ rows().length }} categories</h3>
        @if (rows().length === 0 && !loading()) {
        <cdf-empty-state
          icon="search"
          title="No categories yet"
          description="Create your first category to start tagging courses."
        />
        } @else {
        <cdf-data-table
          [rows]="rows()"
          [columns]="columns"
          emptyMessage="Loading…"
        >
          <ng-template cdfDataTableCell="actions" let-row>
            <div class="row-actions">
              <cdf-button kind="ghost" size="sm" (click)="startEdit(row)">
                Edit
              </cdf-button>
              <cdf-button kind="danger" size="sm" (click)="confirmDelete(row)">
                Delete
              </cdf-button>
            </div>
          </ng-template>
        </cdf-data-table>
        }
      </section>

      <aside class="card form-card">
        <h3>{{ form().id ? 'Edit category' : 'New category' }}</h3>

        <cdf-form-field
          label="Slug"
          hint="Kebab-case identifier — e.g. frontend, ai-usage"
          [error]="errors()['slug'] ?? null"
        >
          <cdf-input
            [(ngModel)]="formInputs.slug"
            (ngModelChange)="onField('slug', $event)"
            placeholder="frontend"
          />
        </cdf-form-field>

        <cdf-form-field label="Name" [error]="errors()['name'] ?? null">
          <cdf-input
            [(ngModel)]="formInputs.name"
            (ngModelChange)="onField('name', $event)"
            placeholder="Frontend"
          />
        </cdf-form-field>

        <cdf-form-field label="Description (optional)">
          <cdf-input
            [(ngModel)]="formInputs.description"
            (ngModelChange)="onField('description', $event)"
            placeholder="Courses focused on the frontend stack."
          />
        </cdf-form-field>

        <cdf-form-field label="Icon name (optional)">
          <cdf-input
            [(ngModel)]="formInputs.iconName"
            (ngModelChange)="onField('iconName', $event)"
            placeholder="gear"
          />
        </cdf-form-field>

        <cdf-form-field label="Color token (optional)">
          <cdf-input
            [(ngModel)]="formInputs.colorToken"
            (ngModelChange)="onField('colorToken', $event)"
            placeholder="primary"
          />
        </cdf-form-field>

        <div class="form-actions">
          <cdf-button kind="primary" [loading]="saving()" (click)="save()">
            {{ form().id ? 'Save changes' : 'Create' }}
          </cdf-button>
          <cdf-button kind="ghost" (click)="resetForm()" [disabled]="saving()">
            Cancel
          </cdf-button>
        </div>

        @if (formError()) {
        <p class="form-error">{{ formError() }}</p>
        }
      </aside>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 1180px;
        margin: 0 auto;
      }
      .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-4);
        h1 {
          margin: 0;
          font-size: var(--cdf-font-size-xl);
        }
        p {
          margin: 4px 0 0;
        }
      }
      .grid {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: var(--cdf-space-4);
        @media (max-width: 960px) {
          grid-template-columns: 1fr;
        }
      }
      .card {
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-4);
        h3 {
          margin: 0 0 var(--cdf-space-3);
          font-size: var(--cdf-font-size-md);
        }
      }
      .form-card {
        position: sticky;
        top: var(--cdf-space-3);
        align-self: start;
      }
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
      .row-actions {
        display: flex;
        gap: 6px;
      }
    `,
  ],
})
export class CategoriesPage {
  private readonly client = inject(CategoriesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly rows = signal<readonly Category[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly saving = signal<boolean>(false);
  protected readonly form = signal<FormState>({ ...EMPTY_FORM });
  protected formInputs = { ...EMPTY_FORM };
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);

  protected readonly columns: DataTableColumn<Category>[] = [
    { key: 'slug', label: 'Slug', value: (r) => r.slug, sortable: true, width: '160px' },
    { key: 'name', label: 'Name', value: (r) => r.name, sortable: true },
    {
      key: 'description',
      label: 'Description',
      value: (r) => r.description ?? '',
    },
    { key: 'iconName', label: 'Icon', value: (r) => r.iconName ?? '', width: '120px' },
    { key: 'actions', label: '', value: () => '', width: '160px', align: 'end' },
  ];

  protected readonly canEdit = computed(() => !this.saving());

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.client.list({ take: 200 });
      this.rows.set(res.items);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Failed to load categories'));
    } finally {
      this.loading.set(false);
    }
  }

  protected startCreate(): void {
    this.formInputs = { ...EMPTY_FORM };
    this.form.set({ ...EMPTY_FORM });
    this.errors.set({});
    this.formError.set(null);
  }

  protected startEdit(row: Category): void {
    const next: FormState = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? '',
      iconName: row.iconName ?? '',
      colorToken: row.colorToken ?? '',
    };
    this.formInputs = { ...next };
    this.form.set(next);
    this.errors.set({});
    this.formError.set(null);
  }

  protected onField(field: keyof FormState, value: string): void {
    this.form.update((f) => ({ ...f, [field]: value }));
    if (this.errors()[field]) {
      this.errors.update((e) => ({ ...e, [field]: undefined }));
    }
  }

  protected resetForm(): void {
    this.startCreate();
  }

  protected async save(): Promise<void> {
    const f = this.form();
    const errs = validate(f);
    if (Object.keys(errs).length > 0) {
      this.errors.set(errs);
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    try {
      const body = {
        slug: f.slug.trim(),
        name: f.name.trim(),
        description: f.description.trim() || undefined,
        iconName: f.iconName.trim() || undefined,
        colorToken: f.colorToken.trim() || undefined,
      };
      if (f.id) {
        const updated = await this.client.update(f.id, body);
        this.rows.update((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
        this.toast.success(`Category "${updated.name}" updated`);
      } else {
        const created = await this.client.create(body);
        this.rows.update((rs) => [created, ...rs]);
        this.toast.success(`Category "${created.name}" created`);
      }
      this.resetForm();
    } catch (err) {
      this.formError.set(this.describeError(err, 'Save failed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async confirmDelete(row: Category): Promise<void> {
    const ok = await this.confirm.open({
      title: `Delete "${row.name}"?`,
      message:
        'The category will be soft-deleted and disappear from the catalog. ' +
        'Existing courses tagged with it stay tagged in their history.',
      confirmLabel: 'Delete',
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.client.remove(row.id);
      this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
      this.toast.success(`Category "${row.name}" deleted`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Delete failed'));
    }
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isUnauthorized) return 'You are signed out. Please sign in again.';
      if (err.isForbidden) return 'Only admins can manage categories.';
      if (err.status === 409) return 'A category with that slug already exists.';
      if (err.message) return err.message;
    }
    return fallback;
  }
}

function validate(f: FormState): Record<string, string> {
  const errs: Record<string, string> = {};
  const slug = f.slug.trim();
  if (!slug) errs['slug'] = 'Required';
  else if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug))
    errs['slug'] = 'Use kebab-case: a-z, 0-9, hyphens.';
  if (!f.name.trim()) errs['name'] = 'Required';
  return errs;
}
