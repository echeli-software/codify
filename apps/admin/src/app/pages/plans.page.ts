import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialogService,
  DataTable,
  DataTableCell,
  type DataTableColumn,
  EmptyState,
  FormField,
  Icon,
  Input,
  Select,
  type SelectOption,
  Textarea,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  CategoriesClient,
  PlansClient,
  ProblemDetailsError,
  type BillingPeriod,
  type Category,
  type Plan,
} from '@codify/api-client';
import { formatPrice } from '@codify/billing';

interface PlanForm {
  id: string | null;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  isAllAccess: boolean;
  trialDays: number;
  categoryIds: string[];
}

interface PriceDraft {
  currency: string;
  amountCents: number;
  period: BillingPeriod;
  maxInstallments: number | null;
}

const EMPTY_FORM: PlanForm = {
  id: null,
  slug: '',
  name: '',
  tagline: '',
  description: '',
  isAllAccess: false,
  trialDays: 7,
  categoryIds: [],
};

const EMPTY_PRICE: PriceDraft = {
  currency: 'BRL',
  amountCents: 3990,
  period: 'MONTHLY',
  maxInstallments: null,
};

/**
 * Admin Plans CRUD + "Sync to Stripe". List on the left; create/edit on the
 * right. A plan's category set defines which courses it unlocks
 * (docs/09-billing §2); `isAllAccess` bypasses the category check. Prices +
 * Stripe sync only appear once a plan exists (they need its id). Stripe sync
 * runs through the BillingProvider — in dev that synthesizes deterministic
 * ids so the flow is exercisable without Stripe keys.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    Checkbox,
    DataTable,
    DataTableCell,
    EmptyState,
    FormField,
    Icon,
    Input,
    Select,
    Textarea,
  ],
  template: `
    <header class="page-header">
      <div>
        <h1>Plans</h1>
        <p class="text-muted">
          Subscription plans + pricing. A plan unlocks every course sharing one
          of its categories; all-access bypasses the check.
        </p>
      </div>
      <cdf-button kind="primary" (click)="startCreate()" data-testid="new-plan-btn">
        <cdf-icon name="plus" size="sm" /> New plan
      </cdf-button>
    </header>

    <div class="grid">
      <section class="card">
        <h3>{{ rows().length }} plans</h3>
        @if (rows().length === 0 && !loading()) {
        <cdf-empty-state
          icon="search"
          title="No plans yet"
          description="Create your first plan, add prices, then sync to Stripe."
        />
        } @else {
        <cdf-data-table [rows]="rows()" [columns]="columns" emptyMessage="Loading…">
          <ng-template cdfDataTableCell="access" let-row>
            @if (row.isAllAccess) {
            <cdf-badge variant="info" [subtle]="true">All-access</cdf-badge>
            } @else {
            <span class="muted">{{ row.categoryIds.length }} categories</span>
            }
          </ng-template>
          <ng-template cdfDataTableCell="prices" let-row>
            <span class="muted">{{ row.prices.length }}</span>
          </ng-template>
          <ng-template cdfDataTableCell="synced" let-row>
            @if (row.syncedToStripe) {
            <cdf-badge variant="success" [subtle]="true">Synced</cdf-badge>
            } @else {
            <cdf-badge variant="warning" [subtle]="true">Not synced</cdf-badge>
            }
          </ng-template>
          <ng-template cdfDataTableCell="actions" let-row>
            <div class="row-actions">
              <cdf-button kind="ghost" size="sm" (click)="startEdit(row)">Edit</cdf-button>
              <cdf-button kind="danger" size="sm" (click)="confirmDelete(row)">Delete</cdf-button>
            </div>
          </ng-template>
        </cdf-data-table>
        }
      </section>

      <aside class="card form-card" data-testid="plan-editor">
        <h3>{{ form().id ? 'Edit plan' : 'New plan' }}</h3>

        <cdf-form-field label="Slug" hint="Kebab-case — e.g. frontend, everything" [error]="errors()['slug'] ?? null">
          <cdf-input [(ngModel)]="formInputs.slug" (ngModelChange)="onField('slug', $event)" placeholder="frontend" data-testid="plan-slug" />
        </cdf-form-field>

        <cdf-form-field label="Name" [error]="errors()['name'] ?? null">
          <cdf-input [(ngModel)]="formInputs.name" (ngModelChange)="onField('name', $event)" placeholder="Frontend Premium" data-testid="plan-name" />
        </cdf-form-field>

        <cdf-form-field label="Tagline (optional)">
          <cdf-input [(ngModel)]="formInputs.tagline" (ngModelChange)="onField('tagline', $event)" placeholder="Everything you need for the frontend track" />
        </cdf-form-field>

        <cdf-form-field label="Description (optional)">
          <cdf-textarea [(ngModel)]="formInputs.description" (ngModelChange)="onField('description', $event)" [rows]="3" />
        </cdf-form-field>

        <cdf-form-field label="Trial days">
          <cdf-input type="number" [(ngModel)]="formInputs.trialDays" (ngModelChange)="onField('trialDays', $event)" />
        </cdf-form-field>

        <div class="checkbox-row">
          <cdf-checkbox [(ngModel)]="formInputs.isAllAccess" (ngModelChange)="onField('isAllAccess', $event)" label="All-access (unlocks every course)" />
        </div>

        @if (!form().isAllAccess) {
        <cdf-form-field label="Categories this plan unlocks">
          @if (categories().length === 0) {
          <p class="muted">No categories yet — create some first.</p>
          } @else {
          <div class="cat-list">
            @for (cat of categories(); track cat.id) {
            <cdf-checkbox
              [ngModel]="form().categoryIds.includes(cat.id)"
              (ngModelChange)="toggleCategory(cat.id, $event)"
              [label]="cat.name"
            />
            }
          </div>
          }
        </cdf-form-field>
        }

        <div class="form-actions">
          <cdf-button kind="primary" [loading]="saving()" (click)="save()" data-testid="plan-save">
            {{ form().id ? 'Save changes' : 'Create' }}
          </cdf-button>
          <cdf-button kind="ghost" (click)="resetForm()" [disabled]="saving()">Cancel</cdf-button>
        </div>
        @if (formError()) {
        <p class="form-error">{{ formError() }}</p>
        }

        <!-- Prices + Stripe sync only once the plan exists. -->
        @if (form().id) {
        <hr />
        <div class="stripe-row">
          <h4>Stripe</h4>
          @if (editing()?.syncedToStripe) {
          <cdf-badge variant="success" [subtle]="true" data-testid="synced-badge">
            {{ editing()?.stripeProductId }}
          </cdf-badge>
          } @else {
          <cdf-badge variant="warning" [subtle]="true">Not synced</cdf-badge>
          }
          <cdf-button kind="secondary" size="sm" [loading]="syncing()" (click)="sync()" data-testid="sync-stripe-btn">
            <cdf-icon name="arrow-clockwise" size="sm" /> Sync to Stripe
          </cdf-button>
        </div>

        <h4>Prices</h4>
        @if ((editing()?.prices?.length ?? 0) === 0) {
        <p class="muted">No prices yet. Add one below, then sync.</p>
        } @else {
        <ul class="price-list" data-testid="price-list">
          @for (p of editing()?.prices ?? []; track p.id) {
          <li>
            <span>{{ formatPriceLabel(p) }}</span>
            @if (p.maxInstallments) {
            <span class="muted">· até {{ p.maxInstallments }}x</span>
            }
            <cdf-button kind="ghost" size="sm" (click)="removePrice(p.id)">Remove</cdf-button>
          </li>
          }
        </ul>
        }

        <div class="price-form">
          <cdf-form-field label="Currency">
            <cdf-select [options]="currencyOptions" [(ngModel)]="priceInputs.currency" (ngModelChange)="priceDraft.set({ ...priceDraft(), currency: $event })" />
          </cdf-form-field>
          <cdf-form-field label="Amount (cents)" hint="e.g. 3990 = R$ 39,90">
            <cdf-input type="number" [(ngModel)]="priceInputs.amountCents" (ngModelChange)="priceDraft.set({ ...priceDraft(), amountCents: +$event })" />
          </cdf-form-field>
          <cdf-form-field label="Period">
            <cdf-select [options]="periodOptions" [(ngModel)]="priceInputs.period" (ngModelChange)="priceDraft.set({ ...priceDraft(), period: $event })" />
          </cdf-form-field>
          <cdf-button kind="secondary" size="sm" [loading]="addingPrice()" (click)="addPrice()" data-testid="add-price-btn">
            Add price
          </cdf-button>
        </div>
        }
      </aside>
    </div>
  `,
  styles: [
    `
      :host { display: block; max-width: 1180px; margin: 0 auto; }
      .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--cdf-space-3); margin-bottom: var(--cdf-space-4);
        h1 { margin: 0; font-size: var(--cdf-font-size-xl); } p { margin: 4px 0 0; } }
      .grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--cdf-space-4); @media (max-width: 960px) { grid-template-columns: 1fr; } }
      .card { background: var(--cdf-color-surface); border: 1px solid var(--cdf-color-border); border-radius: var(--cdf-radius-md); padding: var(--cdf-space-4);
        h3 { margin: 0 0 var(--cdf-space-3); font-size: var(--cdf-font-size-md); } h4 { margin: var(--cdf-space-3) 0 var(--cdf-space-2); font-size: var(--cdf-font-size-sm); } }
      .form-card { position: sticky; top: var(--cdf-space-3); align-self: start; }
      .form-actions { display: flex; gap: var(--cdf-space-2); margin-top: var(--cdf-space-3); }
      .form-error { margin-top: var(--cdf-space-2); color: var(--cdf-color-danger); font-size: 13px; }
      .row-actions { display: flex; gap: 6px; }
      .muted { color: var(--cdf-color-text-muted); font-size: 13px; }
      .checkbox-row { margin: var(--cdf-space-2) 0; }
      .cat-list { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow: auto; }
      .stripe-row { display: flex; align-items: center; gap: var(--cdf-space-2); flex-wrap: wrap; }
      .price-list { list-style: none; padding: 0; margin: 0 0 var(--cdf-space-2); display: flex; flex-direction: column; gap: 4px;
        li { display: flex; align-items: center; gap: 8px; } }
      .price-form { display: grid; grid-template-columns: 1fr 1fr; gap: var(--cdf-space-2); align-items: end; }
      hr { border: none; border-top: 1px solid var(--cdf-color-border); margin: var(--cdf-space-3) 0; }
    `,
  ],
})
export class PlansPage {
  private readonly client = inject(PlansClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly rows = signal<readonly Plan[]>([]);
  protected readonly categories = signal<readonly Category[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly syncing = signal(false);
  protected readonly addingPrice = signal(false);
  protected readonly form = signal<PlanForm>({ ...EMPTY_FORM });
  protected formInputs = { ...EMPTY_FORM };
  protected readonly priceDraft = signal<PriceDraft>({ ...EMPTY_PRICE });
  protected priceInputs = { ...EMPTY_PRICE };
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);

  /** The persisted plan currently open in the editor (for prices + sync). */
  protected readonly editing = computed(() =>
    this.rows().find((p) => p.id === this.form().id) ?? null,
  );

  protected readonly currencyOptions: SelectOption[] = [
    { value: 'BRL', label: 'BRL (R$)' },
    { value: 'USD', label: 'USD ($)' },
  ];
  protected readonly periodOptions: SelectOption<BillingPeriod>[] = [
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'ANNUAL', label: 'Annual' },
  ];

  protected readonly columns: DataTableColumn<Plan>[] = [
    { key: 'name', label: 'Name', value: (r) => r.name, sortable: true },
    { key: 'slug', label: 'Slug', value: (r) => r.slug, width: '140px' },
    { key: 'access', label: 'Access', value: () => '', width: '130px' },
    { key: 'prices', label: 'Prices', value: () => '', width: '80px' },
    { key: 'synced', label: 'Stripe', value: () => '', width: '110px' },
    { key: 'actions', label: '', value: () => '', width: '150px', align: 'end' },
  ];

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [plans, cats] = await Promise.all([
        this.client.list({ includeInactive: true }),
        this.categoriesClient.list({ take: 200 }),
      ]);
      this.rows.set(plans.items);
      this.categories.set(cats.items);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Failed to load plans'));
    } finally {
      this.loading.set(false);
    }
  }

  protected formatPriceLabel(p: { currency: string; amountCents: number; period: BillingPeriod; maxInstallments: number | null }): string {
    return formatPrice(
      { currency: p.currency, amountCents: p.amountCents, period: p.period, maxInstallments: p.maxInstallments },
      'pt-BR',
    );
  }

  protected startCreate(): void {
    this.formInputs = { ...EMPTY_FORM };
    this.form.set({ ...EMPTY_FORM });
    this.errors.set({});
    this.formError.set(null);
  }

  protected startEdit(row: Plan): void {
    const next: PlanForm = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline ?? '',
      description: row.description ?? '',
      isAllAccess: row.isAllAccess,
      trialDays: row.trialDays,
      categoryIds: [...row.categoryIds],
    };
    this.formInputs = { ...next, categoryIds: [...next.categoryIds] };
    this.form.set(next);
    this.errors.set({});
    this.formError.set(null);
  }

  protected onField(field: keyof PlanForm, value: unknown): void {
    this.form.update((f) => ({ ...f, [field]: value }));
    if (this.errors()[field]) this.errors.update((e) => ({ ...e, [field]: undefined }));
  }

  protected toggleCategory(id: string, on: boolean): void {
    this.form.update((f) => ({
      ...f,
      categoryIds: on ? [...new Set([...f.categoryIds, id])] : f.categoryIds.filter((c) => c !== id),
    }));
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
        tagline: f.tagline.trim() || undefined,
        description: f.description.trim() || undefined,
        isAllAccess: f.isAllAccess,
        trialDays: Number(f.trialDays) || 0,
        categoryIds: f.isAllAccess ? [] : f.categoryIds,
      };
      if (f.id) {
        const updated = await this.client.update(f.id, body);
        this.rows.update((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
        this.toast.success(`Plan "${updated.name}" updated`);
      } else {
        const created = await this.client.create(body);
        this.rows.update((rs) => [created, ...rs]);
        this.toast.success(`Plan "${created.name}" created — add prices then sync`);
        // Switch to edit mode so prices + sync become available.
        this.startEdit(created);
      }
    } catch (err) {
      this.formError.set(this.describeError(err, 'Save failed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async sync(): Promise<void> {
    const id = this.form().id;
    if (!id) return;
    this.syncing.set(true);
    try {
      const synced = await this.client.syncToStripe(id);
      this.rows.update((rs) => rs.map((r) => (r.id === synced.id ? synced : r)));
      this.toast.success(`Synced "${synced.name}" to Stripe`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Sync failed'));
    } finally {
      this.syncing.set(false);
    }
  }

  protected async addPrice(): Promise<void> {
    const id = this.form().id;
    if (!id) return;
    const d = this.priceDraft();
    this.addingPrice.set(true);
    try {
      const updated = await this.client.addPrice(id, {
        currency: d.currency,
        amountCents: Number(d.amountCents),
        period: d.period,
        maxInstallments: d.maxInstallments ?? undefined,
      });
      this.rows.update((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      this.priceInputs = { ...EMPTY_PRICE };
      this.priceDraft.set({ ...EMPTY_PRICE });
      this.toast.success('Price added');
    } catch (err) {
      this.toast.error(this.describeError(err, 'Add price failed'));
    } finally {
      this.addingPrice.set(false);
    }
  }

  protected async removePrice(priceId: string): Promise<void> {
    const id = this.form().id;
    if (!id) return;
    try {
      const updated = await this.client.removePrice(id, priceId);
      this.rows.update((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      this.toast.success('Price removed');
    } catch (err) {
      this.toast.error(this.describeError(err, 'Remove price failed'));
    }
  }

  protected async confirmDelete(row: Plan): Promise<void> {
    const ok = await this.confirm.open({
      title: `Delete "${row.name}"?`,
      message: 'The plan will be deactivated and soft-deleted. Existing subscribers keep their access until period end.',
      confirmLabel: 'Delete',
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.client.remove(row.id);
      this.rows.update((rs) => rs.filter((r) => r.id !== row.id));
      if (this.form().id === row.id) this.resetForm();
      this.toast.success(`Plan "${row.name}" deleted`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Delete failed'));
    }
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isUnauthorized) return 'You are signed out. Please sign in again.';
      if (err.isForbidden) return 'Only admins can manage plans.';
      if (err.status === 409) return 'A plan with that slug (or price) already exists.';
      if (err.status === 400) return err.message || 'Add at least one price before syncing.';
      if (err.message) return err.message;
    }
    return fallback;
  }
}

function validate(f: PlanForm): Record<string, string> {
  const errs: Record<string, string> = {};
  const slug = f.slug.trim();
  if (!slug) errs['slug'] = 'Required';
  else if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug))
    errs['slug'] = 'Use kebab-case: a-z, 0-9, hyphens.';
  if (!f.name.trim()) errs['name'] = 'Required';
  return errs;
}
