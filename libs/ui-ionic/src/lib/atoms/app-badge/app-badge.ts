import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { IonBadge } from '@ionic/angular/standalone';

export type AppBadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'coin'
  | 'xp'
  | 'premium';

const VARIANT_TO_COLOR: Record<AppBadgeVariant, string> = {
  neutral: 'medium',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'tertiary',
  coin: 'warning',
  xp: 'primary',
  premium: 'tertiary',
};

/**
 * Color-coded label for status, count, or category. Wraps `<ion-badge>`
 * with a semantic variant taxonomy that matches ui-bootstrap's `Badge`
 * (drop-in mental model across both apps).
 *
 * For interactive / removable labels use `cdf-app-tag`.
 */
@Component({
  selector: 'cdf-app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonBadge],
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-subtle]': 'subtle() ? "" : null',
  },
  template: `
    <ion-badge [color]="ionColor()">
      <ng-content />
    </ion-badge>
  `,
  styleUrl: './app-badge.scss',
})
export class AppBadge {
  readonly variant = input<AppBadgeVariant>('neutral');
  readonly subtle = input(false);

  protected ionColor(): string {
    return VARIANT_TO_COLOR[this.variant()];
  }
}
