import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import { BillingClient, type SubscriptionView } from '@codify/api-client';
import { AppButton, AppCard, AppSkeleton, Icon } from '@codify/ui-ionic';

/**
 * Checkout return page. Stripe (and our dev provider) redirect here after
 * checkout with `?session_id=...`. In dev mode (`&dev=1`) we complete the
 * stubbed checkout here — the local stand-in for the `checkout.session.*`
 * webhook — then confirm the new subscription. In Stripe mode the webhook
 * has already created the Subscription server-side; we just confirm state.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, AppButton, AppCard, AppSkeleton, Icon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Subscription</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (state() === 'working') {
      <cdf-app-skeleton shape="rect" />
      <p class="muted">Confirming your subscription…</p>
      } @else if (state() === 'done') {
      <cdf-app-card padding="normal" class="result" data-testid="checkout-success">
        <cdf-icon name="check-circle" size="lg" />
        <h2>You're in! 🎉</h2>
        <p class="muted">
          {{ sub()?.planName }} is now active@if (sub()?.status === 'TRIALING') {
          (trial) }.
        </p>
        <cdf-app-button kind="primary" [fullWidth]="true" (buttonClick)="go('/today')">
          Start learning
        </cdf-app-button>
        <cdf-app-button kind="ghost" [fullWidth]="true" (buttonClick)="go('/subscription')">
          View subscription
        </cdf-app-button>
      </cdf-app-card>
      } @else {
      <cdf-app-card padding="normal" class="result" data-testid="checkout-error">
        <cdf-icon name="warning" size="lg" />
        <h2>Hmm, that didn't complete</h2>
        <p class="muted">We couldn't confirm a subscription from this link.</p>
        <cdf-app-button kind="primary" [fullWidth]="true" (buttonClick)="go('/subscription')">
          Back to plans
        </cdf-app-button>
      </cdf-app-card>
      }
    </ion-content>
  `,
  styles: [
    `
      .result { text-align: center; display: flex; flex-direction: column; gap: var(--cdf-space-2); }
      .result h2 { margin: var(--cdf-space-1) 0; }
      .muted { color: var(--cdf-color-text-muted); }
    `,
  ],
})
export class BillingSuccessPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly billing = inject(BillingClient);

  protected readonly state = signal<'working' | 'done' | 'error'>('working');
  protected readonly sub = signal<SubscriptionView | null>(null);

  constructor() {
    void this.confirm();
  }

  private async confirm(): Promise<void> {
    const qp = this.route.snapshot.queryParamMap;
    const sessionId = qp.get('session_id');
    const isDev = qp.get('dev') === '1';
    if (!sessionId) {
      this.state.set('error');
      return;
    }
    try {
      if (isDev) {
        // Dev stand-in for the Stripe webhook.
        const sub = await this.billing.completeDevCheckout(sessionId);
        this.sub.set(sub);
        this.state.set('done');
        return;
      }
      // Stripe mode: the webhook created the row; reflect current state.
      const mine = await this.billing.mySubscription();
      const active = mine.subscriptions.find((s) => s.grantsAccess) ?? mine.subscriptions[0] ?? null;
      this.sub.set(active);
      this.state.set(active ? 'done' : 'error');
    } catch {
      this.state.set('error');
    }
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
