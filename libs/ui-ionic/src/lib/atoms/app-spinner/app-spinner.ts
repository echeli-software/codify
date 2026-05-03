import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { IonSpinner } from '@ionic/angular/standalone';

export type AppSpinnerSize = 'sm' | 'md' | 'lg';
export type AppSpinnerVariant = 'crescent' | 'dots' | 'lines';

/**
 * Loading spinner. Wraps Ionic's spinner with our size taxonomy + screen
 * reader label. Use for inline loading state in cards/buttons; for full
 * page loading rely on the route's own skeleton.
 */
@Component({
  selector: 'cdf-app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSpinner],
  host: { '[attr.data-size]': 'size()' },
  template: `
    <ion-spinner [name]="variant()" role="status" [attr.aria-label]="label()" />
    <span class="visually-hidden">{{ label() }}</span>
  `,
  styleUrl: './app-spinner.scss',
})
export class AppSpinner {
  readonly size = input<AppSpinnerSize>('md');
  readonly variant = input<AppSpinnerVariant>('crescent');
  readonly label = input('Loading…');
}
