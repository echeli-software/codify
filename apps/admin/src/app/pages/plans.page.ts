import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import {
  Badge,
  Button,
  type CategoryAssignments,
  CategoryAssignmentMatrix,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  Input,
  type MatrixCategory,
  type MatrixPlan,
  MoneyInput,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  CategoriesClient,
  PlansClient,
  type BillingPeriod,
  type Category,
  type Plan,
  type PlanPrice,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { EDIT_ROLES } from '../core/roles';

interface PlanForm {
  id: string | null;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  isAllAccess: boolean;
  isActive: boolean;
  trialDays: number;
  sortOrder: number;
  revenueCatEntitlementId: string;
}

interface PriceDraft {
  storeProductId: string;
  maxInstallments: number | null;
  isActive: boolean;
}

const PLAN_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/**
 * Plans (docs/09): plan ↔ category matrix, plan basics (incl. RevenueCat
 * entitlement), per-price store product / installments / active flag, new
 * prices, and "Sync to Stripe" with its result. ADMIN edits; SUPPORT views.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    CategoryAssignmentMatrix,
    EmptyState,
    FormField,
    Icon,
    Input,
    MoneyInput,
    Select,
    Skeleton,
    Toggle,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.plans.title' | translate }}</h1>
          <p class="muted">{{ 'admin.plans.subtitle' | translate }}</p>
        </div>
        @if (canEdit()) {
          <cdf-button
            kind="primary"
            (click)="startCreate()"
            data-testid="new-plan"
          >
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.plans.new' | translate }}
          </cdf-button>
        }
      </header>

      @if (loading()) {
        <cdf-skeleton shape="rect" height="200px" />
      } @else {
        <section class="admin-card">
          <header class="section-head">
            <h2>{{ 'admin.plans.matrixTitle' | translate }}</h2>
            @if (canEdit()) {
              <cdf-button
                kind="primary"
                size="sm"
                [disabled]="changedPlanIds().length === 0"
                [loading]="busy() === 'matrix'"
                (click)="saveMatrix()"
                data-testid="save-matrix"
              >
                {{
                  'admin.plans.saveMatrix'
                    | translate: { count: changedPlanIds().length }
                }}
              </cdf-button>
            }
          </header>
          <p class="muted small">{{ 'admin.plans.matrixHelp' | translate }}</p>
          <div class="table-scroll">
            <cdf-category-assignment-matrix
              [plans]="matrixPlans()"
              [categories]="matrixCategories()"
              [value]="assignments()"
              (valueChange)="assignments.set($event)"
              [disabled]="!canEdit()"
              [caption]="'admin.plans.matrixCaption' | translate"
            />
          </div>
        </section>

        <div class="split">
          <section class="admin-card">
            <h2>{{ 'admin.plans.list' | translate }}</h2>
            @if (plans().length === 0) {
              <cdf-empty-state
                icon="credit-card"
                [title]="'admin.plans.emptyTitle' | translate"
                [description]="'admin.plans.emptyDescription' | translate"
              />
            }
            <ul class="plain-list plan-list">
              @for (p of plans(); track p.id) {
                <li>
                  <button
                    type="button"
                    class="plan-row"
                    [attr.aria-current]="selectedId() === p.id ? 'true' : null"
                    (click)="select(p)"
                  >
                    <span class="plan-row__name">{{ p.name }}</span>
                    <span class="chip-row">
                      <cdf-badge
                        [variant]="p.isActive ? 'success' : 'neutral'"
                        [subtle]="true"
                        >{{
                          (p.isActive
                            ? 'admin.common.active'
                            : 'admin.common.inactive'
                          ) | translate
                        }}</cdf-badge
                      >
                      @if (p.isAllAccess) {
                        <cdf-badge variant="premium" [subtle]="true">{{
                          'admin.plans.allAccess' | translate
                        }}</cdf-badge>
                      }
                      @if (p.syncedToStripe) {
                        <cdf-badge variant="info" [subtle]="true">{{
                          'admin.plans.synced' | translate
                        }}</cdf-badge>
                      }
                    </span>
                    <span class="muted small">
                      @for (pr of p.prices; track pr.id; let last = $last) {
                        {{
                          pr.amountCents | locale: 'currency' : pr.currency
                        }}/{{
                          'admin.plans.periodShort.' + pr.period | translate
                        }}{{ last ? '' : ' · ' }}
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
          </section>

          @if (editing()) {
            <section class="admin-card" aria-labelledby="plan-form-title">
              <h2 id="plan-form-title">
                {{
                  (form.id ? 'admin.plans.edit' : 'admin.plans.new') | translate
                }}
              </h2>
              <fieldset class="plain" [disabled]="!canEdit()">
                <div class="form-grid">
                  <cdf-form-field
                    [label]="'admin.common.name' | translate"
                    controlId="plan-name"
                    [error]="errors()['name'] ?? null"
                  >
                    <cdf-input inputId="plan-name" [(ngModel)]="form.name" />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.common.slug' | translate"
                    controlId="plan-slug"
                    [error]="errors()['slug'] ?? null"
                  >
                    <cdf-input inputId="plan-slug" [(ngModel)]="form.slug" />
                  </cdf-form-field>
                  <cdf-form-field
                    class="span-all"
                    [label]="'admin.plans.tagline' | translate"
                    controlId="plan-tagline"
                  >
                    <cdf-input
                      inputId="plan-tagline"
                      [(ngModel)]="form.tagline"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    class="span-all"
                    [label]="'admin.common.description' | translate"
                    controlId="plan-desc"
                  >
                    <cdf-input
                      inputId="plan-desc"
                      [(ngModel)]="form.description"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.plans.trialDays' | translate"
                    controlId="plan-trial"
                  >
                    <cdf-input
                      inputId="plan-trial"
                      type="number"
                      [(ngModel)]="form.trialDays"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.plans.sortOrder' | translate"
                    controlId="plan-sort"
                  >
                    <cdf-input
                      inputId="plan-sort"
                      type="number"
                      [(ngModel)]="form.sortOrder"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    class="span-all"
                    [label]="'admin.plans.entitlement' | translate"
                    [help]="'admin.plans.entitlementHelp' | translate"
                    controlId="plan-rc"
                  >
                    <cdf-input
                      inputId="plan-rc"
                      [(ngModel)]="form.revenueCatEntitlementId"
                    />
                  </cdf-form-field>
                  <cdf-toggle
                    [(ngModel)]="form.isAllAccess"
                    [label]="'admin.plans.allAccessToggle' | translate"
                  />
                  <cdf-toggle
                    [(ngModel)]="form.isActive"
                    [label]="'admin.common.active' | translate"
                  />
                </div>
              </fieldset>
              @if (canEdit()) {
                <div class="form-actions">
                  <cdf-button
                    kind="primary"
                    [loading]="busy() === 'plan'"
                    (click)="savePlan()"
                    data-testid="save-plan"
                  >
                    {{
                      (form.id
                        ? 'admin.common.saveChanges'
                        : 'admin.common.create'
                      ) | translate
                    }}
                  </cdf-button>
                  @if (form.id) {
                    <cdf-button
                      kind="secondary"
                      [loading]="busy() === 'sync'"
                      (click)="syncStripe()"
                      data-testid="sync-stripe"
                    >
                      <cdf-icon name="arrow-clockwise" size="sm" />
                      {{ 'admin.plans.syncStripe' | translate }}
                    </cdf-button>
                  }
                </div>
              }
              @if (formError(); as e) {
                <p class="form-error" role="alert">{{ e }}</p>
              }
              @if (syncResult(); as s) {
                <div
                  class="sync-result"
                  role="status"
                  data-testid="sync-result"
                >
                  <p class="chip-row">
                    <cdf-badge
                      [variant]="s.syncedToStripe ? 'success' : 'warning'"
                      >{{
                        (s.syncedToStripe
                          ? 'admin.plans.syncOk'
                          : 'admin.plans.syncPending'
                        ) | translate
                      }}</cdf-badge
                    >
                    <span class="mono">{{ s.stripeProductId ?? '—' }}</span>
                  </p>
                  <ul class="plain-list small">
                    @for (pr of s.prices; track pr.id) {
                      <li>
                        {{
                          pr.amountCents | locale: 'currency' : pr.currency
                        }}
                        · {{ 'admin.plans.periods.' + pr.period | translate }} →
                        <span class="mono">{{ pr.stripePriceId ?? '—' }}</span>
                      </li>
                    }
                  </ul>
                </div>
              }

              @if (selected(); as p) {
                <h3 class="prices-title">
                  {{ 'admin.plans.prices' | translate }}
                </h3>
                <div class="table-scroll">
                  <table class="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          {{ 'admin.plans.amount' | translate }}
                        </th>
                        <th scope="col">
                          {{ 'admin.plans.storeProduct' | translate }}
                        </th>
                        <th scope="col">
                          {{ 'admin.plans.installments' | translate }}
                        </th>
                        <th scope="col">
                          {{ 'admin.common.active' | translate }}
                        </th>
                        <th scope="col">
                          <span class="visually-hidden">{{
                            'admin.common.actions' | translate
                          }}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (pr of p.prices; track pr.id) {
                        <tr>
                          <td>
                            <strong>{{
                              pr.amountCents | locale: 'currency' : pr.currency
                            }}</strong>
                            <div class="muted small">
                              {{
                                'admin.plans.periods.' + pr.period | translate
                              }}
                            </div>
                            @if (pr.stripePriceId) {
                              <div class="mono muted">
                                {{ pr.stripePriceId }}
                              </div>
                            }
                          </td>
                          <td>
                            <cdf-input
                              size="sm"
                              [ariaLabel]="
                                'admin.plans.storeProduct' | translate
                              "
                              [(ngModel)]="priceDrafts[pr.id].storeProductId"
                              [disabled]="!canEdit()"
                            />
                          </td>
                          <td>
                            <cdf-input
                              size="sm"
                              type="number"
                              [ariaLabel]="
                                'admin.plans.installments' | translate
                              "
                              [(ngModel)]="priceDrafts[pr.id].maxInstallments"
                              [disabled]="!canEdit()"
                            />
                          </td>
                          <td>
                            <cdf-toggle
                              [(ngModel)]="priceDrafts[pr.id].isActive"
                              [disabled]="!canEdit()"
                              [label]="'admin.common.active' | translate"
                            />
                          </td>
                          <td>
                            @if (canEdit()) {
                              <div class="row-actions">
                                <cdf-button
                                  size="sm"
                                  kind="secondary"
                                  [loading]="busy() === pr.id"
                                  (click)="savePrice(p, pr)"
                                >
                                  {{ 'admin.common.save' | translate }}
                                </cdf-button>
                                <cdf-button
                                  size="sm"
                                  kind="ghost"
                                  (click)="removePrice(p, pr)"
                                >
                                  {{ 'admin.common.remove' | translate }}
                                </cdf-button>
                              </div>
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="muted small">
                            {{ 'admin.plans.noPrices' | translate }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (canEdit()) {
                  <h3 class="prices-title">
                    {{ 'admin.plans.addPrice' | translate }}
                  </h3>
                  <div class="form-grid">
                    <cdf-form-field
                      [label]="'admin.plans.currency' | translate"
                      controlId="np-currency"
                    >
                      <cdf-select
                        inputId="np-currency"
                        [options]="currencyOptions"
                        [(ngModel)]="newPrice.currency"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.plans.period' | translate"
                      controlId="np-period"
                    >
                      <cdf-select
                        inputId="np-period"
                        [options]="periodOptions()"
                        [(ngModel)]="newPrice.period"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.plans.amount' | translate"
                      controlId="np-amount"
                    >
                      <cdf-money-input
                        inputId="np-amount"
                        [currency]="newPrice.currency"
                        [(ngModel)]="newPrice.amountCents"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.plans.installments' | translate"
                      [help]="'admin.plans.installmentsHelp' | translate"
                      controlId="np-inst"
                    >
                      <cdf-input
                        inputId="np-inst"
                        type="number"
                        [(ngModel)]="newPrice.maxInstallments"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.plans.storeProduct' | translate"
                      controlId="np-store"
                    >
                      <cdf-input
                        inputId="np-store"
                        [(ngModel)]="newPrice.storeProductId"
                      />
                    </cdf-form-field>
                  </div>
                  <div class="form-actions">
                    <cdf-button
                      kind="secondary"
                      [loading]="busy() === 'price'"
                      (click)="addPrice(p)"
                    >
                      <cdf-icon name="plus" size="sm" />
                      {{ 'admin.plans.addPrice' | translate }}
                    </cdf-button>
                  </div>
                }
              }
            </section>
          }
        </div>
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
      .plan-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .plan-row {
        all: unset;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        cursor: pointer;
      }
      .plan-row[aria-current='true'] {
        border-color: var(--cdf-color-primary);
        background: var(--cdf-color-primary-subtle);
      }
      .plan-row:focus-visible {
        box-shadow: var(--cdf-shadow-focus-ring);
      }
      .plan-row__name {
        font-weight: 600;
      }
      .prices-title {
        font-size: var(--cdf-font-size-sm);
        margin: var(--cdf-space-4) 0 var(--cdf-space-2);
      }
      .sync-result {
        margin-top: var(--cdf-space-3);
        padding: var(--cdf-space-2);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
      }
    `,
  ],
})
export class PlansPage {
  private readonly plansClient = inject(PlansClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly canEdit = computed(() =>
    this.auth.hasAnyRole(EDIT_ROLES.plans),
  );
  protected readonly loading = signal(true);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly assignments = signal<CategoryAssignments>({});
  protected readonly selectedId = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
  protected readonly syncResult = signal<Plan | null>(null);
  protected form: PlanForm = emptyPlanForm();
  protected priceDrafts: Record<string, PriceDraft> = {};
  protected newPrice = {
    currency: 'BRL',
    period: 'MONTHLY' as BillingPeriod,
    amountCents: 2990 as number | null,
    maxInstallments: null as number | null,
    storeProductId: '',
  };

  protected readonly currencyOptions: SelectOption<string>[] = [
    { value: 'BRL', label: 'BRL' },
    { value: 'USD', label: 'USD' },
  ];
  protected readonly periodOptions = computed<SelectOption<BillingPeriod>[]>(
    () => {
      this.i18n.currentLocale();
      return (['MONTHLY', 'ANNUAL'] as const).map((p) => ({
        value: p,
        label: this.i18n.t(`admin.plans.periods.${p}`),
      }));
    },
  );

  protected readonly selected = computed(
    () => this.plans().find((p) => p.id === this.selectedId()) ?? null,
  );
  protected readonly matrixPlans = computed<MatrixPlan[]>(() =>
    this.plans().map((p) => ({
      id: p.id,
      name: p.name,
      hint: p.isAllAccess ? this.i18n.t('admin.plans.allAccess') : undefined,
    })),
  );
  protected readonly matrixCategories = computed<MatrixCategory[]>(() =>
    this.categories().map((c) => ({ id: c.id, name: c.name })),
  );
  protected readonly changedPlanIds = computed(() => {
    const a = this.assignments();
    return this.plans()
      .filter((p) => !sameIds(a[p.id] ?? [], p.categoryIds))
      .map((p) => p.id);
  });

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [plans, cats] = await Promise.all([
        this.plansClient.list({ includeInactive: true }),
        this.categoriesClient.list({ take: 100 }),
      ]);
      this.categories.set(cats.items);
      this.setPlans(plans.items);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      this.loading.set(false);
    }
  }

  private setPlans(plans: Plan[]): void {
    const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
    this.plans.set(sorted);
    this.assignments.set(
      Object.fromEntries(sorted.map((p) => [p.id, [...p.categoryIds]])),
    );
    const sel = sorted.find((p) => p.id === this.selectedId());
    if (sel) this.seedPriceDrafts(sel);
  }

  private replacePlan(p: Plan): void {
    const current = this.assignments();
    this.plans.update((ps) => {
      const exists = ps.some((x) => x.id === p.id);
      return exists ? ps.map((x) => (x.id === p.id ? p : x)) : [...ps, p];
    });
    this.assignments.set({ ...current, [p.id]: [...p.categoryIds] });
    if (p.id === this.selectedId()) this.seedPriceDrafts(p);
  }

  private seedPriceDrafts(p: Plan): void {
    this.priceDrafts = Object.fromEntries(
      p.prices.map((pr) => [
        pr.id,
        {
          storeProductId: pr.storeProductId ?? '',
          maxInstallments: pr.maxInstallments,
          isActive: pr.isActive,
        },
      ]),
    );
  }

  protected startCreate(): void {
    this.selectedId.set(null);
    this.form = emptyPlanForm();
    this.errors.set({});
    this.formError.set(null);
    this.syncResult.set(null);
    this.editing.set(true);
  }

  protected select(p: Plan): void {
    this.selectedId.set(p.id);
    this.form = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline ?? '',
      description: p.description ?? '',
      isAllAccess: p.isAllAccess,
      isActive: p.isActive,
      trialDays: p.trialDays,
      sortOrder: p.sortOrder,
      revenueCatEntitlementId: p.revenueCatEntitlementId ?? '',
    };
    this.seedPriceDrafts(p);
    this.errors.set({});
    this.formError.set(null);
    this.syncResult.set(null);
    this.editing.set(true);
  }

  protected async saveMatrix(): Promise<void> {
    const ids = this.changedPlanIds();
    this.busy.set('matrix');
    try {
      for (const id of ids) {
        const updated = await this.plansClient.update(id, {
          categoryIds: this.assignments()[id] ?? [],
        });
        this.replacePlan(updated);
      }
      this.toast.success(
        this.i18n.t('admin.plans.matrixSaved', { count: ids.length }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async savePlan(): Promise<void> {
    const f = this.form;
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs['name'] = this.i18n.t('admin.common.required');
    if (!PLAN_SLUG.test(f.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    this.errors.set(errs);
    if (Object.keys(errs).length) return;
    const body = {
      slug: f.slug.trim(),
      name: f.name.trim(),
      tagline: f.tagline.trim() || undefined,
      description: f.description.trim() || undefined,
      isAllAccess: f.isAllAccess,
      trialDays: Math.max(0, Math.round(Number(f.trialDays) || 0)),
      sortOrder: Math.max(0, Math.round(Number(f.sortOrder) || 0)),
      revenueCatEntitlementId: f.revenueCatEntitlementId.trim(),
    };
    this.busy.set('plan');
    this.formError.set(null);
    try {
      const saved = f.id
        ? await this.plansClient.update(f.id, { ...body, isActive: f.isActive })
        : await this.plansClient.create(body);
      this.replacePlan(saved);
      this.select(saved);
      this.toast.success(
        this.i18n.t('admin.plans.saved', { name: saved.name }),
      );
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async savePrice(p: Plan, pr: PlanPrice): Promise<void> {
    const d = this.priceDrafts[pr.id];
    const inst =
      d.maxInstallments === null || String(d.maxInstallments) === ''
        ? null
        : Math.round(Number(d.maxInstallments));
    this.busy.set(pr.id);
    try {
      const updated = await this.plansClient.updatePrice(p.id, pr.id, {
        storeProductId: d.storeProductId.trim(),
        isActive: d.isActive,
        maxInstallments: inst,
      });
      this.replacePlan(updated);
      this.toast.success(this.i18n.t('admin.plans.priceSaved'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async removePrice(p: Plan, pr: PlanPrice): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.plans.removePriceTitle'),
      message: this.i18n.t('admin.plans.removePriceMessage'),
      confirmKind: 'danger',
      confirmLabel: this.i18n.t('admin.common.remove'),
    });
    if (!ok) return;
    try {
      this.replacePlan(await this.plansClient.removePrice(p.id, pr.id));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }

  protected async addPrice(p: Plan): Promise<void> {
    const n = this.newPrice;
    if (n.amountCents === null || n.amountCents < 0) {
      this.toast.error(this.i18n.t('admin.common.invalidNumber'));
      return;
    }
    this.busy.set('price');
    try {
      const updated = await this.plansClient.addPrice(p.id, {
        currency: n.currency,
        period: n.period,
        amountCents: n.amountCents,
        ...(n.maxInstallments
          ? { maxInstallments: Math.round(Number(n.maxInstallments)) }
          : {}),
        ...(n.storeProductId.trim()
          ? { storeProductId: n.storeProductId.trim() }
          : {}),
      });
      this.replacePlan(updated);
      this.toast.success(this.i18n.t('admin.plans.priceAdded'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async syncStripe(): Promise<void> {
    const p = this.selected();
    if (!p) return;
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.plans.syncTitle', { name: p.name }),
      message: this.i18n.t('admin.plans.syncMessage'),
      confirmLabel: this.i18n.t('admin.plans.syncStripe'),
      confirmKind: 'primary',
    });
    if (!ok) return;
    this.busy.set('sync');
    this.syncResult.set(null);
    try {
      const synced = await this.plansClient.syncToStripe(p.id);
      this.replacePlan(synced);
      this.syncResult.set(synced);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.plans.syncFailed');
    } finally {
      this.busy.set(null);
    }
  }
}

function emptyPlanForm(): PlanForm {
  return {
    id: null,
    slug: '',
    name: '',
    tagline: '',
    description: '',
    isAllAccess: false,
    isActive: true,
    trialDays: 0,
    sortOrder: 0,
    revenueCatEntitlementId: '',
  };
}
