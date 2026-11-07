import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { AppChip } from '../../atoms/app-chip/app-chip.js';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';
import { Icon } from '../../atoms/icon/icon.js';
import { PriceTag, type BillingPeriod } from '../price-tag/price-tag.js';
import type { CourseCategoryRef } from '../course-card/course-card.js';

let planSeq = 0;

/**
 * Plan offer card (docs/09): name, price + installments, included
 * categories as chips, perks, and the CTA. `current` swaps the CTA for a
 * "Current plan" badge; `highlight` adds the recommended treatment.
 *
 *   <cdf-plan-card name="Pro" [amountCents]="5990" [installments]="12"
 *                  [categories]="cats" [features]="perks" (choose)="checkout(plan.id)" />
 */
@Component({
  selector: 'cdf-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, AppChip, AppBadge, Icon, PriceTag, TranslatePipe],
  host: { '[attr.data-highlight]': 'highlight() ? "" : null' },
  template: `
    <article class="cdf-plan" [attr.aria-labelledby]="headingId">
      <header class="cdf-plan__head">
        <h3 class="cdf-plan__name" [id]="headingId">{{ name() }}</h3>
        @if (badge(); as b) {
          <cdf-app-badge variant="success" [subtle]="true">{{
            b
          }}</cdf-app-badge>
        } @else if (highlight()) {
          <cdf-app-badge variant="primary">{{
            'ui.plan.recommended' | translate
          }}</cdf-app-badge>
        }
      </header>
      @if (description(); as d) {
        <p class="cdf-plan__desc">{{ d }}</p>
      }
      <cdf-price-tag
        size="lg"
        [amountCents]="amountCents()"
        [currency]="currency()"
        [period]="period()"
        [installments]="installments()"
        [compareAtCents]="compareAtCents()"
      />

      @if (categories().length) {
        <p class="cdf-plan__section">{{ 'ui.plan.includes' | translate }}</p>
        <div class="cdf-plan__chips">
          @for (c of categories(); track c.id) {
            <cdf-app-chip variant="primary" [outline]="true">{{
              c.label
            }}</cdf-app-chip>
          }
        </div>
      }

      @if (features().length) {
        <ul class="cdf-plan__features">
          @for (f of features(); track f) {
            <li>
              <cdf-icon name="check-circle" size="sm" /> <span>{{ f }}</span>
            </li>
          }
        </ul>
      }

      <footer class="cdf-plan__cta">
        @if (current()) {
          <cdf-app-badge variant="success">{{
            'billing.currentPlan' | translate
          }}</cdf-app-badge>
        } @else {
          <cdf-app-button
            [kind]="highlight() ? 'primary' : 'secondary'"
            [fullWidth]="true"
            [loading]="loading()"
            (buttonClick)="choose.emit()"
          >
            {{ ctaLabel() ?? ('billing.subscribe' | translate) }}
          </cdf-app-button>
        }
      </footer>
    </article>
  `,
  styleUrl: './plan-card.scss',
})
export class PlanCard {
  readonly name = input.required<string>();
  readonly description = input<string | null>(null);
  readonly amountCents = input.required<number>();
  readonly currency = input('BRL');
  readonly period = input<BillingPeriod>('monthly');
  readonly installments = input<number | null>(null);
  readonly compareAtCents = input<number | null>(null);
  readonly categories = input<CourseCategoryRef[]>([]);
  readonly features = input<string[]>([]);
  readonly badge = input<string | null>(null);
  readonly highlight = input(false);
  readonly current = input(false);
  readonly loading = input(false);
  readonly ctaLabel = input<string | null>(null);

  readonly choose = output<void>();

  protected readonly headingId = `cdf-plan-${++planSeq}`;
}
