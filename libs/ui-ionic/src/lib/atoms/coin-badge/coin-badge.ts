import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { formatCoins, formatCompact } from '@codify/ui-core';

/**
 * Inline coin indicator: ● + number. Locale-aware. Used in the header
 * counter, lesson rewards, shop prices, anywhere coins surface in UI.
 *
 * The coin icon is a styled CSS dot rather than ionicons because we want
 * full control over the gradient/animation when later phases add the
 * coin-fly effect. (See docs/07-gamification.md §11.)
 */
@Component({
  selector: 'cdf-coin-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-tone]': 'tone()',
  },
  template: `
    <span class="cdf-coin-badge__icon" aria-hidden="true"></span>
    <span class="cdf-coin-badge__value">{{ formatted() }}</span>
    @if (showLabel()) {
      <span class="cdf-coin-badge__label">{{
        'ui.coins.unit' | translate: { count: value() }
      }}</span>
    }
  `,
  styleUrl: './coin-badge.scss',
})
export class CoinBadge {
  readonly value = input.required<number>();
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly compact = input(false);
  readonly showLabel = input(false);
  /** 'plain' (default), 'gain' (green +N), 'large' (overlay celebration). */
  readonly tone = input<'plain' | 'gain' | 'large'>('plain');

  private readonly i18n = inject(I18nService);

  protected readonly formatted = computed(() => {
    const v = this.value();
    const locale = this.i18n.currentLocale();
    if (this.tone() === 'gain') {
      return v >= 0 ? `+${formatCoins(v, locale)}` : formatCoins(v, locale);
    }
    return this.compact() ? formatCompact(v, locale) : formatCoins(v, locale);
  });
}
