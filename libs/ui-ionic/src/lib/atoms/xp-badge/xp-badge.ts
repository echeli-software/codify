import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { I18nService } from '@codify/i18n';
import { formatXp, formatCompact } from '@codify/ui-core';
import { Icon } from '../icon/icon.js';

/**
 * Inline XP indicator: ✨ + number. Locale-aware via I18nService. Used in
 * headers, lesson rows, leaderboards — anywhere a "this is worth X XP" or
 * "you have X XP" appears.
 */
@Component({
  selector: 'cdf-xp-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-tone]': 'tone()',
  },
  template: `
    <cdf-icon name="sparkles" [size]="iconSize()" />
    <span class="cdf-xp-badge__value">{{ formatted() }}</span>
    @if (showLabel()) {
    <span class="cdf-xp-badge__label">XP</span>
    }
  `,
  styleUrl: './xp-badge.scss',
})
export class XpBadge {
  readonly value = input.required<number>();
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly compact = input(false);
  readonly showLabel = input(true);
  /** 'plain' (default), 'gain' (green +N), 'large' (level-up overlay style). */
  readonly tone = input<'plain' | 'gain' | 'large'>('plain');

  private readonly i18n = inject(I18nService);

  protected readonly iconSize = computed<'xs' | 'sm' | 'md' | 'lg'>(() => {
    const s = this.size();
    if (s === 'sm') return 'xs';
    if (s === 'lg') return 'md';
    return 'sm';
  });

  protected readonly formatted = computed(() => {
    const v = this.value();
    const locale = this.i18n.currentLocale();
    if (this.tone() === 'gain') {
      return v >= 0 ? `+${formatXp(v, locale)}` : formatXp(v, locale);
    }
    return this.compact() ? formatCompact(v, locale) : formatXp(v, locale);
  });
}
