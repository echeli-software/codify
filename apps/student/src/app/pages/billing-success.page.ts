import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  BillingClient,
  type MySubscriptionResponse,
  type SubscriptionView,
} from '@codify/api-client';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { AppButton, AppCard, AppSkeleton, Icon } from '@codify/ui-ionic';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { errorMessageKey } from '../platform/app-toast.service.js';

/** Poll cadence / budget while an async PIX / Boleto payment is pending. */
export const SUCCESS_POLL_MS = 3000;
export const SUCCESS_POLL_BUDGET_MS = 120_000;

/** The subscription a finished checkout produced (access-granting, plan match first). */
export function confirmedSubscription(
  mine: MySubscriptionResponse,
  planId: string | null,
): SubscriptionView | null {
  const granting = mine.subscriptions.filter((s) => s.grantsAccess);
  return (
    (planId ? granting.find((s) => s.planId === planId) : undefined) ??
    granting[0] ??
    null
  );
}

/**
 * Checkout return page. Dev provider (`&dev=1`): completes the stubbed
 * session here (the local stand-in for the webhook). Stripe: the webhook
 * creates the subscription — card is usually instant, while PIX / Boleto
 * complete the session before the money arrives, so the page shows a
 * "payment pending" state and keeps polling the subscription.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppSkeleton,
    Icon,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.billing.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="bs" aria-live="polite">
        @switch (state()) {
          @case ('working') {
            <cdf-app-skeleton shape="rect" [height]="120" />
            <p class="bs__muted" role="status">
              {{ 'student.billing.success.confirming' | translate }}
            </p>
          }
          @case ('pending') {
            <cdf-app-card
              padding="spacious"
              class="bs__card"
              data-testid="checkout-pending"
            >
              <cdf-icon name="hourglass" size="lg" />
              <h1>{{ 'student.billing.success.pendingTitle' | translate }}</h1>
              <p>
                {{ 'student.billing.success.pending.' + method() | translate }}
              </p>
              @if (polling()) {
                <p class="bs__muted" role="status">
                  {{ 'student.billing.success.checking' | translate }}
                </p>
              } @else {
                <cdf-app-button
                  kind="primary"
                  (buttonClick)="startPolling()"
                  data-testid="check-again"
                >
                  {{ 'student.billing.success.checkAgain' | translate }}
                </cdf-app-button>
              }
              <cdf-app-button kind="ghost" routerLink="/today">{{
                'student.billing.success.keepLearning' | translate
              }}</cdf-app-button>
            </cdf-app-card>
          }
          @case ('done') {
            <cdf-app-card
              padding="spacious"
              class="bs__card"
              data-testid="checkout-success"
            >
              <cdf-icon name="check-circle" size="lg" />
              <h1>{{ 'student.billing.success.doneTitle' | translate }}</h1>
              @if (sub(); as s) {
                <p>
                  {{
                    (s.status === 'TRIALING'
                      ? 'student.billing.success.trialActive'
                      : 'student.billing.success.active'
                    )
                      | translate
                        : {
                            plan: s.planName,
                            date:
                              (s.currentPeriodEnd | locale: 'date' : 'long'),
                          }
                  }}
                </p>
              }
              <cdf-app-button
                kind="primary"
                [fullWidth]="true"
                routerLink="/today"
                >{{
                  'student.billing.success.start' | translate
                }}</cdf-app-button
              >
              <cdf-app-button
                kind="ghost"
                [fullWidth]="true"
                routerLink="/subscription"
                >{{
                  'student.billing.success.view' | translate
                }}</cdf-app-button
              >
            </cdf-app-card>
          }
          @default {
            <cdf-app-card
              padding="spacious"
              class="bs__card"
              data-testid="checkout-error"
            >
              <cdf-icon name="warning" size="lg" />
              <h1>{{ 'student.billing.success.errorTitle' | translate }}</h1>
              <p>
                {{
                  errorKey() ?? 'student.billing.success.errorBody' | translate
                }}
              </p>
              <cdf-app-button
                kind="primary"
                [fullWidth]="true"
                routerLink="/subscription"
                >{{
                  'student.billing.success.back' | translate
                }}</cdf-app-button
              >
            </cdf-app-card>
          }
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .bs {
        max-width: 560px;
        margin: 0 auto;
      }
      .bs__card {
        display: block;
        text-align: center;
      }
      .bs__card h1 {
        font-size: var(--cdf-font-size-xl);
        margin: var(--cdf-space-2) 0;
      }
      .bs__card cdf-app-button {
        display: block;
        margin-top: var(--cdf-space-2);
      }
      .bs__muted {
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
export class BillingSuccessPage {
  private readonly route = inject(ActivatedRoute);
  private readonly billing = inject(BillingClient);
  private readonly telemetry = inject(TelemetryService);

  protected readonly state = signal<'working' | 'pending' | 'done' | 'error'>(
    'working',
  );
  protected readonly sub = signal<SubscriptionView | null>(null);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly polling = signal(false);
  protected readonly method = signal<'card' | 'pix' | 'boleto'>('card');
  private planId: string | null = null;
  private period: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.timer) clearTimeout(this.timer);
    });
    void this.confirm();
  }

  private async confirm(): Promise<void> {
    const qp = this.route.snapshot.queryParamMap;
    const sessionId = qp.get('session_id');
    const m = qp.get('method');
    this.method.set(m === 'pix' || m === 'boleto' ? m : 'card');
    this.planId = qp.get('plan');
    this.period = qp.get('period');
    if (!sessionId) {
      this.state.set('error');
      return;
    }
    try {
      if (qp.get('dev') === '1') {
        // Dev stand-in for the Stripe webhook.
        this.finish(await this.billing.completeDevCheckout(sessionId));
        return;
      }
      const found = confirmedSubscription(
        await this.billing.mySubscription(),
        this.planId,
      );
      if (found) {
        this.finish(found);
      } else {
        // Webhook not processed yet — always the case for PIX / Boleto.
        this.state.set('pending');
        this.startPolling();
      }
    } catch (err) {
      this.errorKey.set(errorMessageKey(err));
      this.state.set('error');
    }
  }

  protected startPolling(): void {
    const deadline = Date.now() + SUCCESS_POLL_BUDGET_MS;
    this.polling.set(true);
    const tick = async (): Promise<void> => {
      if (this.destroyed) return;
      try {
        const found = confirmedSubscription(
          await this.billing.mySubscription(),
          this.planId,
        );
        if (found) {
          this.polling.set(false);
          this.finish(found);
          return;
        }
      } catch {
        // Transient — keep polling until the budget runs out.
      }
      if (Date.now() >= deadline) {
        this.polling.set(false);
        return;
      }
      this.timer = setTimeout(() => void tick(), SUCCESS_POLL_MS);
    };
    this.timer = setTimeout(() => void tick(), SUCCESS_POLL_MS);
  }

  private finish(sub: SubscriptionView): void {
    this.sub.set(sub);
    this.state.set('done');
    this.telemetry.track('checkout_complete', {
      planId: this.planId ?? sub.planId,
      period: this.period,
      method: this.method(),
    });
  }
}
