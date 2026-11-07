import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  BillingClient,
  type PaymentStatus,
  type PaymentView,
} from '@codify/api-client';
import { formatMoney } from '@codify/billing';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  Icon,
  type AppBadgeVariant,
} from '@codify/ui-ionic';

const PAGE = 10;

const STATUS_VARIANT: Record<PaymentStatus, AppBadgeVariant> = {
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'warning',
};

const METHOD_KEYS = new Set(['card', 'pix', 'boleto', 'store']);

/**
 * Subscription → Billing history (docs/05 §Subscription, docs/09 §6):
 * date, amount, method, status and a receipt link per payment, newest
 * first, paged with "Show more". Amounts use the billing lib's money
 * formatter in the current locale.
 */
@Component({
  selector: 'cdf-billing-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AppBadge,
    AppButton,
    AppCard,
    AppSkeleton,
    Icon,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <section
      class="bh"
      aria-labelledby="bh-title"
      data-testid="billing-history"
    >
      <h2 id="bh-title">{{ 'student.billingHistory.title' | translate }}</h2>
      @if (loading()) {
        <cdf-app-skeleton shape="rect" [height]="96" />
      } @else if (failed()) {
        <cdf-app-card padding="normal">
          <p class="bh__muted">
            {{ 'student.billingHistory.error' | translate }}
          </p>
          <cdf-app-button kind="ghost" (buttonClick)="reload()">{{
            'common.retry' | translate
          }}</cdf-app-button>
        </cdf-app-card>
      } @else if (items().length === 0) {
        <cdf-app-card padding="normal">
          <p class="bh__muted" data-testid="billing-history-empty">
            {{ 'student.billingHistory.empty' | translate }}
          </p>
        </cdf-app-card>
      } @else {
        <cdf-app-card padding="none">
          <ul class="bh__list">
            @for (p of items(); track p.id) {
              <li class="bh__row" data-testid="payment-row">
                <div class="bh__main">
                  <span class="bh__amount">{{ amount(p) }}</span>
                  <span class="bh__meta">
                    {{ p.paidAt ?? p.createdAt | locale: 'date' }}
                    @if (p.planName) {
                      · {{ p.planName }}
                    }
                    · {{ methodKey(p) | translate }}
                  </span>
                  @if (
                    p.refundedCents > 0 && p.status === 'PARTIALLY_REFUNDED'
                  ) {
                    <span class="bh__meta">{{
                      'student.billingHistory.refunded'
                        | translate: { amount: refunded(p) }
                    }}</span>
                  }
                </div>
                <div class="bh__side">
                  <cdf-app-badge [variant]="variant(p)" [subtle]="true">{{
                    'student.billingHistory.status.' + p.status | translate
                  }}</cdf-app-badge>
                  @if (p.receiptUrl) {
                    <a
                      class="bh__receipt"
                      [href]="p.receiptUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      [attr.aria-label]="
                        'student.billingHistory.receiptFor'
                          | translate
                            : {
                                date:
                                  (p.paidAt ?? p.createdAt | locale: 'date'),
                              }
                      "
                    >
                      {{ 'student.billingHistory.receipt' | translate }}
                      <cdf-icon name="arrow-forward" size="xs" />
                    </a>
                  }
                </div>
              </li>
            }
          </ul>
        </cdf-app-card>
        @if (items().length < total()) {
          <cdf-app-button
            kind="ghost"
            [loading]="loadingMore()"
            (buttonClick)="more()"
            data-testid="billing-history-more"
            >{{ 'student.billingHistory.more' | translate }}</cdf-app-button
          >
        }
      }
    </section>
  `,
  styles: [
    `
      .bh {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-3);
      }
      h2 {
        margin: 0;
        font-size: var(--cdf-font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .bh__muted {
        margin: 0;
        color: var(--cdf-color-text-muted);
      }
      .bh__list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .bh__row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2) var(--cdf-space-3);
        border-bottom: 1px solid var(--cdf-color-border);
      }
      .bh__row:last-child {
        border-bottom: 0;
      }
      .bh__main,
      .bh__side {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .bh__side {
        align-items: flex-end;
        flex: none;
      }
      .bh__amount {
        font-weight: 700;
      }
      .bh__meta {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        overflow-wrap: anywhere;
      }
      .bh__receipt {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-height: 32px;
        color: var(--cdf-color-primary);
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
      }
      .bh__receipt:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class BillingHistoryComponent {
  private readonly billing = inject(BillingClient);
  private readonly i18n = inject(I18nService);

  protected readonly items = signal<PaymentView[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const page = await this.billing.myPayments({ skip: 0, take: PAGE });
      this.items.set(page.items);
      this.total.set(page.total);
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async more(): Promise<void> {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.billing.myPayments({
        skip: this.items().length,
        take: PAGE,
      });
      this.items.update((list) => [...list, ...page.items]);
      this.total.set(page.total);
    } catch {
      this.failed.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected amount(p: PaymentView): string {
    return formatMoney(p.amountCents, p.currency, this.i18n.currentLocale());
  }

  protected refunded(p: PaymentView): string {
    return formatMoney(p.refundedCents, p.currency, this.i18n.currentLocale());
  }

  protected methodKey(p: PaymentView): string {
    const m = p.method && METHOD_KEYS.has(p.method) ? p.method : 'unknown';
    return `student.billingHistory.method.${m}`;
  }

  protected variant(p: PaymentView): AppBadgeVariant {
    return STATUS_VARIANT[p.status] ?? 'neutral';
  }
}
