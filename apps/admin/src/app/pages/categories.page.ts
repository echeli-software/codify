import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
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
import { CategoriesClient, type Category } from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES } from '../core/roles';

interface FormState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  iconName: string;
  colorToken: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  name: '',
  description: '',
  iconName: '',
  colorToken: '',
};

const CATEGORY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Catalog → Categories: the taxonomy used to tag courses, filter the
 * student catalog and bind plans (plan ↔ category matrix lives on Plans).
 * ADMIN edits; SUPPORT gets a read-only list.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Button,
    DataTable,
    DataTableCell,
    EmptyState,
    FormField,
    Icon,
    Input,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.categories.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.categories.subtitle' | translate }}
            <a routerLink="/plans">{{
              'admin.categories.plansLink' | translate
            }}</a>
          </p>
        </div>
        @if (canEdit()) {
          <cdf-button kind="primary" (click)="startCreate()">
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.categories.new' | translate }}
          </cdf-button>
        }
      </header>

      <div [class.split]="canEdit()">
        <section class="admin-card">
          <h2>
            {{ 'admin.categories.count' | translate: { count: rows().length } }}
          </h2>
          @if (rows().length === 0 && !loading()) {
            <cdf-empty-state
              icon="folder-open"
              [title]="'admin.categories.emptyTitle' | translate"
              [description]="'admin.categories.emptyDescription' | translate"
            />
          } @else {
            <cdf-data-table
              [rows]="rows()"
              [columns]="columns()"
              [emptyMessage]="'admin.common.loading' | translate"
            >
              <ng-template cdfDataTableCell="actions" let-row>
                @if (canEdit()) {
                  <div class="row-actions">
                    <cdf-button kind="ghost" size="sm" (click)="startEdit(row)">
                      {{ 'admin.common.edit' | translate }}
                    </cdf-button>
                    <cdf-button
                      kind="danger"
                      size="sm"
                      (click)="confirmDelete(row)"
                    >
                      {{ 'admin.common.delete' | translate }}
                    </cdf-button>
                  </div>
                }
              </ng-template>
            </cdf-data-table>
          }
        </section>

        @if (canEdit()) {
          <aside class="admin-card" aria-labelledby="cat-form-title">
            <h2 id="cat-form-title">
              {{
                (form.id ? 'admin.categories.edit' : 'admin.categories.new')
                  | translate
              }}
            </h2>
            <cdf-form-field
              [label]="'admin.common.slug' | translate"
              [help]="'admin.categories.slugHelp' | translate"
              controlId="cat-slug"
              [error]="errors()['slug'] ?? null"
            >
              <cdf-input inputId="cat-slug" [(ngModel)]="form.slug" />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.common.name' | translate"
              controlId="cat-name"
              [error]="errors()['name'] ?? null"
            >
              <cdf-input inputId="cat-name" [(ngModel)]="form.name" />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.common.description' | translate"
              controlId="cat-desc"
            >
              <cdf-input inputId="cat-desc" [(ngModel)]="form.description" />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.categories.icon' | translate"
              [help]="'admin.categories.iconHelp' | translate"
              controlId="cat-icon"
            >
              <cdf-input inputId="cat-icon" [(ngModel)]="form.iconName" />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.categories.color' | translate"
              [help]="'admin.categories.colorHelp' | translate"
              controlId="cat-color"
            >
              <cdf-input inputId="cat-color" [(ngModel)]="form.colorToken" />
            </cdf-form-field>
            <div class="form-actions">
              <cdf-button kind="primary" [loading]="saving()" (click)="save()">
                {{
                  (form.id ? 'admin.common.saveChanges' : 'admin.common.create')
                    | translate
                }}
              </cdf-button>
              @if (form.id) {
                <cdf-button kind="ghost" (click)="startCreate()">
                  {{ 'admin.common.cancel' | translate }}
                </cdf-button>
              }
            </div>
            @if (formError(); as e) {
              <p class="form-error" role="alert">{{ e }}</p>
            }
          </aside>
        }
      </div>
    </div>
  `,
})
export class CategoriesPage {
  private readonly client = inject(CategoriesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly canEdit = computed(() =>
    this.auth.hasAnyRole(EDIT_ROLES.categories),
  );
  protected readonly rows = signal<readonly Category[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected form: FormState = { ...EMPTY_FORM };
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);

  protected readonly columns = computed<DataTableColumn<Category>[]>(() => {
    this.i18n.currentLocale();
    const t = (k: string) => this.i18n.t(k);
    return [
      {
        key: 'slug',
        label: t('admin.common.slug'),
        value: (r) => r.slug,
        sortable: true,
        width: '160px',
      },
      {
        key: 'name',
        label: t('admin.common.name'),
        value: (r) => r.name,
        sortable: true,
      },
      {
        key: 'description',
        label: t('admin.common.description'),
        value: (r) => r.description ?? '',
      },
      {
        key: 'iconName',
        label: t('admin.categories.icon'),
        value: (r) => r.iconName ?? '',
        width: '120px',
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
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set((await this.client.list({ take: 100 })).items);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      this.loading.set(false);
    }
  }

  protected startCreate(): void {
    this.form = { ...EMPTY_FORM };
    this.errors.set({});
    this.formError.set(null);
  }

  protected startEdit(row: Category): void {
    this.form = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? '',
      iconName: row.iconName ?? '',
      colorToken: row.colorToken ?? '',
    };
    this.errors.set({});
    this.formError.set(null);
  }

  protected async save(): Promise<void> {
    const f = this.form;
    const errs: Record<string, string> = {};
    if (!f.slug.trim()) errs['slug'] = this.i18n.t('admin.common.required');
    else if (!CATEGORY_SLUG.test(f.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    if (!f.name.trim()) errs['name'] = this.i18n.t('admin.common.required');
    this.errors.set(errs);
    if (Object.keys(errs).length) return;

    this.saving.set(true);
    this.formError.set(null);
    const body = {
      slug: f.slug.trim(),
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      iconName: f.iconName.trim() || undefined,
      colorToken: f.colorToken.trim() || undefined,
    };
    try {
      if (f.id) {
        const updated = await this.client.update(f.id, body);
        this.rows.update((rs) =>
          rs.map((r) => (r.id === updated.id ? updated : r)),
        );
        this.toast.success(
          this.i18n.t('admin.categories.updated', { name: updated.name }),
        );
      } else {
        const created = await this.client.create(body);
        this.rows.update((rs) => [created, ...rs]);
        this.toast.success(
          this.i18n.t('admin.categories.created', { name: created.name }),
        );
      }
      this.startCreate();
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async confirmDelete(row: Category): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: row.name }),
      message: this.i18n.t('admin.categories.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.client.remove(row.id);
      this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
      this.toast.success(
        this.i18n.t('admin.categories.deleted', { name: row.name }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }
}
