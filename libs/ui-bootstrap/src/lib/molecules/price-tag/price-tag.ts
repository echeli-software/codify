import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import {
  formatCurrency,
  formatInstallmentAmount,
} from '@codify/ui-core';
import { I18nService, TranslatePipe } from '@codify/i18n';

export type BillingPeriod = 'monthly' | 'annual' | 'oneoff';

/**
 * Canonical price renderer used everywhere a plan/item price appears.
 * Reads the active locale from i18n so the same component renders
 * "R$ 39,90/mês" or "$9.99/mo" without each call site repeating the work.
 *
 *   <cdf-price-tag [amountCents]="3990" currency="BRL" period="monthly" />
 *   <cdf-price-tag [amountCents]="47880" currency="BRL" period="annual" [installments]="12" />
 */
@Component({
  selector: 'cdf-price-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <span class="cdf-price">
      @switch (period()) { @case ('oneoff') {
      <span class="cdf-price__amount">{{ formatted() }}</span>
      } @case ('annual') {
      <span class="cdf-price__amount">{{
        'billing.perYear' | translate: { price: formatted() }
      }}</span>
      } @default {
      <span class="cdf-price__amount">{{
        'billing.perMonth' | translate: { price: formatted() }
      }}</span>
      } } @if (installmentText(); as txt) {
      <span class="cdf-price__installments">· {{ txt }}</span>
      }
    </span>
  `,
  styleUrl: './price-tag.scss',
})
export class PriceTag {
  readonly amountCents = input.required<number>();
  readonly currency = input<string>('BRL');
  readonly period = input<BillingPeriod>('monthly');
  /** Up to N installments. Display only — Stripe is the source of truth. */
  readonly installments = input<number | null>(null);

  private readonly i18n = inject(I18nService);

  protected readonly formatted = computed(() =>
    formatCurrency(this.amountCents(), this.currency(), this.i18n.currentLocale()),
  );

  protected readonly installmentText = computed(() => {
    const n = this.installments();
    if (!n || n <= 1) return null;
    const per = formatInstallmentAmount(
      this.amountCents(),
      n,
      this.currency(),
      this.i18n.currentLocale(),
    );
    return `${n}x ${per}`;
  });
}
