import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { formatCurrency, formatInstallmentAmount } from '@codify/ui-core';

export type BillingPeriod = 'monthly' | 'annual' | 'oneoff';

/**
 * Price renderer — identical contract to the admin `cdf-price-tag`
 * (docs/03): `{ amountCents, currency, period, installments }`, formatted
 * for the current locale ("R$ 39,90/mês · 12x de R$ 3,99").
 *
 *   <cdf-price-tag [amountCents]="47880" currency="BRL" period="annual" [installments]="12" />
 */
@Component({
  selector: 'cdf-price-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { '[attr.data-size]': 'size()' },
  template: `
    <span class="cdf-price">
      <span class="cdf-price__amount">
        @switch (period()) {
          @case ('oneoff') {
            {{ formatted() }}
          }
          @case ('annual') {
            {{ 'billing.perYear' | translate: { price: formatted() } }}
          }
          @default {
            {{ 'billing.perMonth' | translate: { price: formatted() } }}
          }
        }
      </span>
      @if (perInstallment(); as per) {
        <span class="cdf-price__installments">
          {{
            'ui.price.installments'
              | translate: { count: installments(), amount: per }
          }}
        </span>
      }
      @if (compareAtCents(); as was) {
        <span class="cdf-price__was">
          <span class="cdf-sr-only">{{ 'ui.price.was' | translate }}</span>
          <s>{{ format(was) }}</s>
        </span>
      }
    </span>
  `,
  styleUrl: './price-tag.scss',
})
export class PriceTag {
  readonly amountCents = input.required<number>();
  readonly currency = input<string>('BRL');
  readonly period = input<BillingPeriod>('monthly');
  /** Display-only installment count (BR cards). */
  readonly installments = input<number | null>(null);
  /** Optional struck-through original price (promotions). */
  readonly compareAtCents = input<number | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  private readonly i18n = inject(I18nService);

  protected readonly formatted = computed(() =>
    this.format(this.amountCents()),
  );

  protected readonly perInstallment = computed(() => {
    const n = this.installments();
    if (!n || n <= 1) return null;
    return formatInstallmentAmount(
      this.amountCents(),
      n,
      this.currency(),
      this.i18n.currentLocale(),
    );
  });

  protected format(cents: number): string {
    return formatCurrency(cents, this.currency(), this.i18n.currentLocale());
  }
}
