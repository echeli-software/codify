import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'coin'
  | 'xp'
  | 'premium';

/**
 * Small color-coded label. Use for status, counts, or category indicators.
 * For dismissable / interactive labels use `cdf-tag` instead.
 */
@Component({
  selector: 'cdf-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="cssClass()"><ng-content /></span>`,
  styleUrl: './badge.scss',
})
export class Badge {
  readonly variant = input<BadgeVariant>('neutral');
  readonly subtle = input(false);

  protected readonly cssClass = computed(() => {
    const cls = ['cdf-badge', `cdf-badge--${this.variant()}`];
    if (this.subtle()) cls.push('cdf-badge--subtle');
    return cls.join(' ');
  });
}
