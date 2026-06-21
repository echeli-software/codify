import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  BillingClient,
  PlansClient,
  type MySubscriptionResponse,
  type Plan,
  type PlanPrice,
} from '@codify/api-client';
import { formatPrice } from '@codify/billing';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  EmptyState,
  Icon,
} from '@codify/ui-ionic';

/**
 * Student Subscription screen. Shows the current subscription state (status,
 * plan, renewal/trial date + "Manage" → Stripe Customer Portal) and a plan
 * picker. Subscribing starts a Checkout session and redirects to the
 * provider URL; in dev that URL is our own success page which completes the
 * (stubbed) checkout. See docs/09-billing.md §5.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppBadge,
    AppButton,
    AppCard,
    AppSkeleton,
    EmptyState,
    Icon,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Subscription</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
      <cdf-app-skeleton shape="rect" />
      <cdf-app-skeleton shape="text" />
      } @else {

      <!-- Current subscription -->
      @if (activeSub(); as sub) {
      <cdf-app-card padding="normal" class="current" data-testid="current-subscription">
        <div class="current__head">
          <h2>{{ sub.planName }}</h2>
          <cdf-app-badge [variant]="statusVariant(sub.status)" [subtle]="true">
            {{ sub.status }}
          </cdf-app-badge>
        </div>
        @if (sub.status === 'TRIALING' && sub.trialEndsAt) {
        <p class="muted">Trial ends {{ formatDate(sub.trialEndsAt) }}</p>
        } @else {
        <p class="muted">Renews {{ formatDate(sub.currentPeriodEnd) }}</p>
        }
        <cdf-app-button kind="secondary" [loading]="portalLoading()" (buttonClick)="openPortal()" data-testid="manage-btn">
          <cdf-icon name="settings" size="sm" /> Manage subscription
        </cdf-app-button>
      </cdf-app-card>
      } @else {
      <cdf-app-card padding="normal" class="pitch" data-testid="no-subscription">
        <cdf-icon name="diamond" size="lg" />
        <h2>Go Premium</h2>
        <p class="muted">
          Unlock every course in your plan, earn an XP multiplier, and keep your
          streak alive offline.
        </p>
      </cdf-app-card>
      }

      <!-- Plan picker -->
      <h3 class="section-title">{{ activeSub() ? 'Change plan' : 'Choose a plan' }}</h3>
      @if (plans().length === 0) {
      <cdf-empty-state icon="diamond" title="No plans available" description="Check back soon." />
      } @else {
      <div class="plans" data-testid="plan-list">
        @for (plan of plans(); track plan.id) {
        <cdf-app-card padding="normal" class="plan" [attr.data-plan-id]="plan.id">
          <div class="plan__head">
            <h3>{{ plan.name }}</h3>
            @if (plan.isAllAccess) {
            <cdf-app-badge variant="info" [subtle]="true">All-access</cdf-app-badge>
            }
          </div>
          @if (plan.tagline) {
          <p class="muted">{{ plan.tagline }}</p>
          }
          @if (plan.trialDays > 0) {
          <p class="trial">{{ plan.trialDays }}-day free trial</p>
          }
          <div class="plan__prices">
            @for (price of plan.prices; track price.id) {
            <cdf-app-button
              kind="primary"
              [fullWidth]="true"
              [loading]="checkoutId() === price.id"
              (buttonClick)="subscribe(price.id)"
              [attr.data-testid]="'subscribe-btn'"
              [attr.data-price-id]="price.id"
            >
              {{ priceLabel(price) }}
            </cdf-app-button>
            }
          </div>
        </cdf-app-card>
        }
      </div>
      }
      }
    </ion-content>
  `,
  styles: [
    `
      .current, .pitch { margin-bottom: var(--cdf-space-4); }
      .current__head, .plan__head { display: flex; align-items: center; justify-content: space-between; gap: var(--cdf-space-2); }
      .current__head h2, .pitch h2 { margin: 0; }
      .pitch { text-align: center; }
      .muted { color: var(--cdf-color-text-muted); }
      .trial { color: var(--cdf-color-success, #2e7d32); font-weight: 600; margin: 4px 0; }
      .section-title { margin: var(--cdf-space-4) 0 var(--cdf-space-2); }
      .plans { display: flex; flex-direction: column; gap: var(--cdf-space-3); }
      .plan__prices { display: flex; flex-direction: column; gap: var(--cdf-space-2); margin-top: var(--cdf-space-2); }
    `,
  ],
})
export class SubscriptionPage {
  private readonly billing = inject(BillingClient);
  private readonly plansClient = inject(PlansClient);

  protected readonly loading = signal(true);
  protected readonly plans = signal<readonly Plan[]>([]);
  protected readonly mine = signal<MySubscriptionResponse | null>(null);
  protected readonly checkoutId = signal<string | null>(null);
  protected readonly portalLoading = signal(false);

  /** The first access-granting subscription, if any. */
  protected readonly activeSub = computed(
    () => this.mine()?.subscriptions.find((s) => s.grantsAccess) ?? null,
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [plans, mine] = await Promise.all([
        this.plansClient.list(),
        this.billing.mySubscription().catch(() => null),
      ]);
      this.plans.set(plans.items);
      this.mine.set(mine);
    } finally {
      this.loading.set(false);
    }
  }

  protected priceLabel(p: PlanPrice): string {
    return formatPrice(
      { currency: p.currency, amountCents: p.amountCents, period: p.period, maxInstallments: p.maxInstallments },
      'pt-BR',
    );
  }

  protected statusVariant(status: string): 'success' | 'warning' | 'neutral' {
    if (status === 'ACTIVE' || status === 'TRIALING') return 'success';
    if (status === 'PAST_DUE') return 'warning';
    return 'neutral';
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected async subscribe(priceId: string): Promise<void> {
    this.checkoutId.set(priceId);
    try {
      const origin = window.location.origin;
      const res = await this.billing.createCheckout({
        planPriceId: priceId,
        paymentMethod: 'card',
        successUrl: `${origin}/billing/success`,
        cancelUrl: `${origin}/subscription`,
      });
      // Redirect to the provider checkout. In dev this is our own success
      // page, which completes the stubbed checkout.
      window.location.href = res.url;
    } catch {
      this.checkoutId.set(null);
    }
  }

  protected async openPortal(): Promise<void> {
    this.portalLoading.set(true);
    try {
      const res = await this.billing.createPortal();
      window.location.href = res.url;
    } catch {
      this.portalLoading.set(false);
    }
  }
}
