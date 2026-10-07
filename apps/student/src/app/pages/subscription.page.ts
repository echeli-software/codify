import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  BillingClient,
  PlansClient,
  type MySubscriptionResponse,
  type PaymentMethod,
  type Plan,
  type PlanPrice,
  type SubscriptionView,
} from '@codify/api-client';
import { formatPrice } from '@codify/billing';
import {
  I18nService,
  LocalePipe,
  TranslatePipe,
  formatForLocale,
} from '@codify/i18n';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  BottomSheet,
  EmptyState,
  Icon,
  PlanCard,
  type AppBadgeVariant,
} from '@codify/ui-ionic';
import {
  NativePlatformService,
  StoreProductMissingError,
} from '../native/native-platform.service.js';
import { AppToastService } from '../platform/app-toast.service.js';
import { OfflineGate } from '../platform/offline-gate.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { activePrices, annualSavings } from './shared/plan-view.js';
import {
  currentSubscription,
  methodsFor,
  subscriptionActions,
} from './billing/subscription-view.js';

const CANCEL_REASONS = [
  'tooExpensive',
  'notUsing',
  'missingContent',
  'technical',
  'other',
] as const;

/**
 * Subscription (docs/09 §5, docs/05 §3): the current plan with status,
 * renewal / access dates, source and whether it grants access; a past-due
 * banner; cancel (one clear path, a confirm sheet stating exactly what
 * happens, an optional skippable reason) and resume; store-bought plans
 * point to the App Store / Google Play. The plan picker offers card (with
 * installments) and, for the annual BRL price, PIX and Boleto. Inside the
 * native app purchases go through the store.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    AppBadge,
    AppButton,
    AppCard,
    AppSkeleton,
    BottomSheet,
    EmptyState,
    Icon,
    PlanCard,
    OfflineGate,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/profile"
            [text]="'common.back' | translate"
          />
        </ion-buttons>
        <ion-title>{{ 'student.billing.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="sb">
        <cdf-offline-gate capability="payments">
          @if (loading()) {
            <cdf-app-skeleton shape="rect" [height]="160" />
            <cdf-app-skeleton shape="rect" [height]="240" />
          } @else {
            @if (sub(); as s) {
              @if (actions(); as a) {
                @if (a.pastDue) {
                  <div
                    class="sb__banner"
                    role="alert"
                    data-testid="past-due-banner"
                  >
                    <cdf-icon name="warning" size="md" />
                    <div>
                      <strong>{{
                        'student.billing.pastDue.title' | translate
                      }}</strong>
                      <p>{{ 'student.billing.pastDue.body' | translate }}</p>
                    </div>
                    @if (!a.store) {
                      <cdf-app-button
                        kind="primary"
                        size="sm"
                        [loading]="portalLoading()"
                        (buttonClick)="openPortal()"
                      >
                        {{ 'student.billing.updatePayment' | translate }}
                      </cdf-app-button>
                    }
                  </div>
                }

                <cdf-app-card
                  padding="normal"
                  data-testid="current-subscription"
                  [attr.data-status]="s.status"
                >
                  <div class="sb__head">
                    <div>
                      <p class="sb__eyebrow">
                        {{ 'student.billing.currentPlan' | translate }}
                      </p>
                      <h2>{{ s.planName }}</h2>
                    </div>
                    <cdf-app-badge
                      [variant]="statusVariant(s)"
                      [subtle]="true"
                      data-testid="subscription-status"
                    >
                      {{ 'student.billing.status.' + s.status | translate }}
                    </cdf-app-badge>
                  </div>
                  <dl class="sb__facts">
                    <div>
                      <dt>{{ 'student.billing.fact.access' | translate }}</dt>
                      <dd>
                        {{
                          (s.grantsAccess
                            ? 'student.billing.accessYes'
                            : 'student.billing.accessNo'
                          ) | translate
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ 'student.billing.fact.source' | translate }}</dt>
                      <dd>
                        {{ 'student.billing.source.' + s.source | translate }}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {{
                          (s.renews && !s.cancelAtPeriodEnd
                            ? 'student.billing.fact.renews'
                            : 'student.billing.fact.ends'
                          ) | translate
                        }}
                      </dt>
                      <dd data-testid="subscription-date">
                        {{ a.periodEnd | locale: 'date' : 'long' }}
                      </dd>
                    </div>
                  </dl>
                  @if (s.status === 'TRIALING' && s.trialEndsAt) {
                    <p class="sb__note">
                      {{
                        'billing.trialEnds'
                          | translate
                            : {
                                date: (s.trialEndsAt | locale: 'date' : 'long'),
                              }
                      }}
                    </p>
                  }
                  @if (a.canResume) {
                    <p class="sb__note" data-testid="cancel-pending">
                      {{
                        'student.billing.cancelPending'
                          | translate
                            : { date: (a.periodEnd | locale: 'date' : 'long') }
                      }}
                    </p>
                  }
                  @if (a.prepaid) {
                    <p class="sb__note">
                      {{
                        'student.billing.prepaidNote'
                          | translate
                            : { date: (a.periodEnd | locale: 'date' : 'long') }
                      }}
                    </p>
                  }
                  @if (a.grant) {
                    <p class="sb__note">
                      {{ 'student.billing.grantNote' | translate }}
                    </p>
                  }
                  @if (a.store) {
                    <p class="sb__note" data-testid="store-managed">
                      <cdf-icon name="info-circle" size="xs" />
                      {{
                        (a.store === 'APPLE'
                          ? 'student.billing.manageApple'
                          : 'student.billing.manageGoogle'
                        ) | translate
                      }}
                    </p>
                  }

                  <div class="sb__actions">
                    @if (a.canResume) {
                      <cdf-app-button
                        kind="primary"
                        [loading]="busy()"
                        (buttonClick)="resume()"
                        data-testid="resume-btn"
                      >
                        {{ 'student.billing.resume' | translate }}
                      </cdf-app-button>
                    }
                    @if (!a.store && !a.grant && s.source === 'STRIPE_WEB') {
                      <cdf-app-button
                        kind="secondary"
                        [loading]="portalLoading()"
                        (buttonClick)="openPortal()"
                        data-testid="manage-btn"
                      >
                        <cdf-icon name="settings" size="sm" />
                        {{ 'student.billing.managePayment' | translate }}
                      </cdf-app-button>
                    }
                    @if (a.canCancel) {
                      <cdf-app-button
                        kind="ghost"
                        (buttonClick)="confirmOpen.set(true)"
                        data-testid="cancel-btn"
                      >
                        {{ 'student.billing.cancel' | translate }}
                      </cdf-app-button>
                    }
                  </div>
                </cdf-app-card>
              }
            } @else {
              <cdf-app-card
                padding="normal"
                class="sb__pitch"
                data-testid="no-subscription"
              >
                <cdf-icon name="diamond" size="lg" />
                <h2>{{ 'student.billing.freeTitle' | translate }}</h2>
                <p>{{ 'student.billing.freeBody' | translate }}</p>
              </cdf-app-card>
            }

            <!-- Plan picker -->
            <section aria-labelledby="sb-plans" class="sb__plans-section">
              <div class="sb__plans-head">
                <h2 id="sb-plans">
                  {{
                    (sub()
                      ? 'student.billing.otherPlans'
                      : 'student.billing.choosePlan'
                    ) | translate
                  }}
                </h2>
                <div
                  class="sb__period"
                  role="group"
                  [attr.aria-label]="'student.billing.periodLabel' | translate"
                >
                  <button
                    type="button"
                    [attr.aria-pressed]="period() === 'MONTHLY'"
                    (click)="period.set('MONTHLY')"
                    data-testid="period-monthly"
                  >
                    {{ 'ui.paywall.cadence.monthly' | translate }}
                  </button>
                  <button
                    type="button"
                    [attr.aria-pressed]="period() === 'ANNUAL'"
                    (click)="period.set('ANNUAL')"
                    data-testid="period-annual"
                  >
                    {{ 'ui.paywall.cadence.yearly' | translate }}
                  </button>
                </div>
              </div>
              @if (offers().length === 0) {
                <cdf-empty-state
                  icon="diamond"
                  [title]="'student.billing.noPlans' | translate"
                  [description]="'student.billing.noPlansBody' | translate"
                />
              } @else {
                <div class="sb__plans" data-testid="plan-list">
                  @for (o of offers(); track o.price.id) {
                    <cdf-plan-card
                      [attr.data-plan-id]="o.plan.id"
                      [attr.data-price-id]="o.price.id"
                      [name]="o.plan.name"
                      [description]="o.plan.tagline ?? o.plan.description"
                      [amountCents]="o.price.amountCents"
                      [currency]="o.price.currency"
                      [period]="
                        o.price.period === 'ANNUAL' ? 'annual' : 'monthly'
                      "
                      [installments]="o.installments"
                      [badge]="o.badge"
                      [highlight]="o.plan.isAllAccess"
                      [current]="activePlanIds().has(o.plan.id)"
                      [ctaLabel]="'student.billing.select' | translate"
                      (choose)="selectPrice(o.plan, o.price)"
                    />
                  }
                </div>
              }
            </section>

            @if (isNative) {
              <cdf-app-button
                kind="ghost"
                [loading]="restoreLoading()"
                (buttonClick)="restore()"
                data-testid="restore-btn"
              >
                <cdf-icon name="refresh" size="sm" />
                {{ 'student.billing.restore' | translate }}
              </cdf-app-button>
            }
          }
        </cdf-offline-gate>
      </div>

      <!-- Checkout: payment method -->
      @if (selected(); as sel) {
        <cdf-bottom-sheet
          [open]="checkoutOpen()"
          (openChange)="checkoutOpen.set($event)"
          [title]="
            'student.billing.checkoutTitle' | translate: { plan: sel.plan.name }
          "
        >
          <div class="sb__checkout" data-testid="checkout-sheet">
            <p class="sb__price">
              {{ priceLabel(sel.price, method() !== 'card') }}
            </p>
            @if (sel.plan.trialDays > 0 && method() === 'card') {
              <p class="sb__note">
                {{
                  'student.plans.trialDays'
                    | translate: { count: sel.plan.trialDays }
                }}
              </p>
            }
            @if (isNative) {
              <p class="sb__note">
                {{ 'student.billing.storeCheckout' | translate }}
              </p>
            } @else {
              <fieldset class="sb__methods">
                <legend>{{ 'student.billing.methodLabel' | translate }}</legend>
                @for (m of allMethods; track m) {
                  <label
                    class="sb__method"
                    [class.sb__method--off]="!methods().includes(m)"
                  >
                    <input
                      type="radio"
                      name="method"
                      [value]="m"
                      [disabled]="!methods().includes(m)"
                      [checked]="method() === m"
                      (change)="method.set(m)"
                      [attr.data-testid]="'method-' + m"
                    />
                    <span>
                      <strong>{{
                        'student.billing.method.' + m + '.title' | translate
                      }}</strong>
                      <small>{{
                        (methods().includes(m)
                          ? 'student.billing.method.' + m + '.body'
                          : 'student.billing.method.annualOnly'
                        ) | translate
                      }}</small>
                    </span>
                  </label>
                }
              </fieldset>
            }
          </div>
          <div sheetFooter class="sb__sheet-actions">
            <cdf-app-button
              kind="ghost"
              (buttonClick)="checkoutOpen.set(false)"
              >{{ 'common.cancel' | translate }}</cdf-app-button
            >
            <cdf-app-button
              kind="primary"
              [loading]="checkingOut()"
              (buttonClick)="checkout()"
              data-testid="checkout-btn"
            >
              {{ 'student.billing.continueCheckout' | translate }}
            </cdf-app-button>
          </div>
        </cdf-bottom-sheet>
      }

      <!-- Cancel confirmation: states exactly what happens; equal-weight choices. -->
      @if (sub(); as s) {
        <cdf-bottom-sheet
          [open]="confirmOpen()"
          (openChange)="confirmOpen.set($event)"
          [title]="'student.billing.confirm.title' | translate"
        >
          <div class="sb__confirm" data-testid="cancel-sheet">
            <ul>
              <li>
                {{
                  'student.billing.confirm.keepAccess'
                    | translate
                      : { date: (s.currentPeriodEnd | locale: 'date' : 'long') }
                }}
              </li>
              <li>{{ 'student.billing.confirm.noCharge' | translate }}</li>
              <li>{{ 'student.billing.confirm.resumeAnytime' | translate }}</li>
            </ul>
            <label class="sb__reason">
              <span>{{
                'student.billing.confirm.reasonLabel' | translate
              }}</span>
              <select [(ngModel)]="reason" name="reason">
                <option value="">
                  {{ 'student.billing.confirm.reasonSkip' | translate }}
                </option>
                @for (r of reasons; track r) {
                  <option [value]="r">
                    {{ 'student.billing.confirm.reasons.' + r | translate }}
                  </option>
                }
              </select>
            </label>
          </div>
          <div sheetFooter class="sb__sheet-actions">
            <cdf-app-button
              kind="secondary"
              (buttonClick)="confirmOpen.set(false)"
              data-testid="keep-btn"
            >
              {{ 'student.billing.confirm.keep' | translate }}
            </cdf-app-button>
            <cdf-app-button
              kind="danger"
              [loading]="busy()"
              (buttonClick)="cancel()"
              data-testid="confirm-cancel-btn"
            >
              {{ 'student.billing.confirm.cancel' | translate }}
            </cdf-app-button>
          </div>
        </cdf-bottom-sheet>
      }
    </ion-content>
  `,
  styles: [
    `
      .sb {
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      h2 {
        margin: 0;
        font-size: var(--cdf-font-size-lg);
      }
      .sb__banner {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        flex-wrap: wrap;
        padding: var(--cdf-space-3);
        border-radius: 12px;
        border: 1px solid var(--cdf-color-warning);
        background: color-mix(
          in srgb,
          var(--cdf-color-warning) 12%,
          transparent
        );
        margin-bottom: var(--cdf-space-3);
      }
      .sb__banner p {
        margin: 2px 0 0;
      }
      .sb__banner > div {
        flex: 1 1 220px;
      }
      .sb__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cdf-space-2);
      }
      .sb__eyebrow {
        margin: 0;
        font-size: var(--cdf-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .sb__facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--cdf-space-2);
        margin: var(--cdf-space-3) 0;
      }
      .sb__facts dt {
        font-size: var(--cdf-font-size-xs);
        color: var(--cdf-color-text-muted);
      }
      .sb__facts dd {
        margin: 0;
        font-weight: 600;
      }
      .sb__note {
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
        display: flex;
        gap: 4px;
        align-items: flex-start;
      }
      .sb__actions,
      .sb__sheet-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
      }
      .sb__sheet-actions {
        justify-content: flex-end;
      }
      .sb__pitch {
        text-align: center;
      }
      .sb__plans-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--cdf-space-2);
        flex-wrap: wrap;
        margin-bottom: var(--cdf-space-2);
      }
      .sb__period {
        display: inline-flex;
        border: 1px solid var(--cdf-color-border);
        border-radius: 999px;
        padding: 2px;
      }
      .sb__period button {
        border: 0;
        background: transparent;
        color: var(--cdf-color-text);
        font: inherit;
        padding: 6px 14px;
        border-radius: 999px;
        cursor: pointer;
        min-height: 36px;
      }
      .sb__period button[aria-pressed='true'] {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-on-primary, #fff);
      }
      .sb__period button:focus-visible,
      .sb__method input:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .sb__plans {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: var(--cdf-space-3);
        align-items: start;
      }
      .sb__price {
        font-size: var(--cdf-font-size-lg);
        font-weight: 700;
        margin-top: 0;
      }
      .sb__methods {
        border: 0;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .sb__methods legend {
        font-weight: 600;
        margin-bottom: var(--cdf-space-2);
      }
      .sb__method {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        padding: var(--cdf-space-2);
        border: 1px solid var(--cdf-color-border);
        border-radius: 12px;
        cursor: pointer;
      }
      .sb__method span {
        display: flex;
        flex-direction: column;
      }
      .sb__method small {
        color: var(--cdf-color-text-muted);
      }
      .sb__method--off {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .sb__confirm ul {
        padding-left: 18px;
        margin-top: 0;
      }
      .sb__confirm li {
        margin-bottom: 6px;
      }
      .sb__reason {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--cdf-font-size-sm);
      }
      .sb__reason select {
        font: inherit;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
      }
    `,
  ],
})
export class SubscriptionPage {
  private readonly billing = inject(BillingClient);
  private readonly plansClient = inject(PlansClient);
  private readonly native = inject(NativePlatformService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);

  protected readonly allMethods: PaymentMethod[] = ['card', 'pix', 'boleto'];
  protected readonly reasons = CANCEL_REASONS;
  protected readonly loading = signal(true);
  protected readonly plans = signal<readonly Plan[]>([]);
  protected readonly mine = signal<MySubscriptionResponse | null>(null);
  protected readonly period = signal<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  protected readonly selected = signal<{ plan: Plan; price: PlanPrice } | null>(
    null,
  );
  protected readonly method = signal<PaymentMethod>('card');
  protected readonly checkoutOpen = signal(false);
  protected readonly checkingOut = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly portalLoading = signal(false);
  protected readonly restoreLoading = signal(false);
  protected reason = '';

  /** Inside the Capacitor shell → store IAP + "Restore purchases". */
  protected get isNative(): boolean {
    return this.native.isNative;
  }

  protected readonly sub = computed<SubscriptionView | null>(() =>
    currentSubscription(this.mine()?.subscriptions ?? []),
  );
  protected readonly actions = computed(() => {
    const s = this.sub();
    return s ? subscriptionActions(s) : null;
  });
  protected readonly activePlanIds = computed(
    () => new Set(this.mine()?.activePlanIds ?? []),
  );
  protected readonly methods = computed(() => {
    const s = this.selected();
    return s ? methodsFor(s.price, this.isNative) : [];
  });

  /** One card per plan for the chosen period (falls back to its other price). */
  protected readonly offers = computed(() => {
    this.i18n.currentLocale();
    const want = this.period();
    return this.plans()
      .map((plan) => {
        const prices = activePrices(plan);
        const price = prices.find((p) => p.period === want) ?? prices[0];
        if (!price) return null;
        const savings = annualSavings(plan, price);
        return {
          plan,
          price,
          installments:
            price.period === 'ANNUAL' && (price.maxInstallments ?? 0) > 1
              ? price.maxInstallments
              : null,
          badge: savings
            ? this.i18n.t('student.plans.save', {
                pct: Math.round(savings * 100),
              })
            : null,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
  });

  constructor() {
    void this.load().then(() => this.applyQuery());
    this.telemetry.track('plans_view', { source: 'settings' });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [plans, mine] = await Promise.all([
        this.plansClient.list(),
        this.billing.mySubscription(),
      ]);
      this.plans.set(plans.items.filter((p) => p.isActive));
      this.mine.set(mine);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  /** `?price=` (from a paywall) preselects a price; `?checkout=canceled` returns from checkout. */
  private applyQuery(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('checkout') === 'canceled') {
      this.telemetry.track('checkout_cancel', {
        planId: qp.get('plan'),
        period: qp.get('period'),
        method: qp.get('method'),
      });
      this.toast.show({
        message: 'student.billing.checkoutCanceled',
        kind: 'info',
      });
    }
    const priceId = qp.get('price');
    if (!priceId) return;
    for (const plan of this.plans()) {
      const price = plan.prices.find((p) => p.id === priceId && p.isActive);
      if (price) {
        this.period.set(price.period);
        this.selectPrice(plan, price);
        return;
      }
    }
  }

  protected selectPrice(plan: Plan, price: PlanPrice): void {
    this.selected.set({ plan, price });
    this.method.set('card');
    this.checkoutOpen.set(true);
  }

  protected priceLabel(p: PlanPrice, noInstallments: boolean): string {
    return formatPrice(
      {
        currency: p.currency,
        amountCents: p.amountCents,
        period: p.period,
        maxInstallments: p.maxInstallments,
      },
      this.i18n.currentLocale(),
      { installments: !noInstallments },
    );
  }

  protected statusVariant(s: SubscriptionView): AppBadgeVariant {
    if (s.status === 'PAST_DUE' || s.cancelAtPeriodEnd) return 'warning';
    if (s.status === 'ACTIVE' || s.status === 'TRIALING') return 'success';
    return 'neutral';
  }

  protected async checkout(): Promise<void> {
    const sel = this.selected();
    if (!sel || this.checkingOut()) return;
    const method = this.isNative ? 'store' : this.method();
    this.checkingOut.set(true);
    this.telemetry.track('checkout_start', {
      planId: sel.plan.id,
      period: sel.price.period,
      method,
    });

    // Native: digital subscriptions must go through the store (App Store /
    // Play rules); the RevenueCat webhook mirrors the entitlement.
    if (this.isNative) {
      try {
        const ok = await this.native.purchasePrice(sel.price);
        if (ok) {
          this.telemetry.track('checkout_complete', {
            planId: sel.plan.id,
            period: sel.price.period,
            method,
          });
          this.checkoutOpen.set(false);
          this.toast.show({
            message: 'student.billing.purchased',
            kind: 'success',
          });
          await this.load();
        }
      } catch (err) {
        if (err instanceof StoreProductMissingError) {
          this.toast.show({
            message: 'student.billing.storeMissing',
            kind: 'warning',
          });
        } else {
          this.toast.error(err);
        }
      } finally {
        this.checkingOut.set(false);
      }
      return;
    }

    try {
      const origin = window.location.origin;
      const ctx = `plan=${encodeURIComponent(sel.plan.id)}&period=${sel.price.period}&method=${method}`;
      const res = await this.billing.createCheckout({
        planPriceId: sel.price.id,
        paymentMethod: this.method(),
        successUrl: `${origin}/billing/success?${ctx}`,
        cancelUrl: `${origin}/subscription?checkout=canceled&${ctx}`,
      });
      window.location.href = res.url;
    } catch (err) {
      this.toast.error(err);
      this.checkingOut.set(false);
    }
  }

  protected async cancel(): Promise<void> {
    const s = this.sub();
    if (!s) return;
    this.busy.set(true);
    try {
      const updated = await this.billing.cancelSubscription({
        subscriptionId: s.id,
        ...(this.reason ? { reason: this.reason } : {}),
      });
      this.replace(updated);
      this.confirmOpen.set(false);
      this.toast.show({
        message: 'student.billing.canceled',
        kind: 'info',
        params: {
          date: formatForLocale(
            updated.currentPeriodEnd,
            this.i18n.currentLocale(),
            'date',
            'long',
          ),
        },
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async resume(): Promise<void> {
    const s = this.sub();
    if (!s) return;
    this.busy.set(true);
    try {
      this.replace(
        await this.billing.resumeSubscription({ subscriptionId: s.id }),
      );
      this.toast.show({ message: 'student.billing.resumed', kind: 'success' });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  private replace(updated: SubscriptionView): void {
    this.mine.update((m) =>
      m
        ? {
            ...m,
            subscriptions: m.subscriptions.map((x) =>
              x.id === updated.id ? updated : x,
            ),
          }
        : m,
    );
  }

  protected async openPortal(): Promise<void> {
    this.portalLoading.set(true);
    try {
      const res = await this.billing.createPortal(
        `${window.location.origin}/subscription`,
      );
      window.location.href = res.url;
    } catch (err) {
      this.toast.error(err);
      this.portalLoading.set(false);
    }
  }

  protected async restore(): Promise<void> {
    this.restoreLoading.set(true);
    try {
      const restored = await this.native.restorePurchases();
      this.telemetry.track('restore_purchases', { found: restored });
      if (restored) await this.load();
      this.toast.show({
        message: restored
          ? 'student.billing.restored'
          : 'student.billing.nothingToRestore',
        kind: restored ? 'success' : 'info',
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.restoreLoading.set(false);
    }
  }
}
