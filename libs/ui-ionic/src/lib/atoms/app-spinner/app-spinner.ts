import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
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
  imports: [IonSpinner, TranslatePipe],
  host: { '[attr.data-size]': 'size()' },
  template: `
    <ion-spinner
      [name]="variant()"
      role="status"
      [attr.aria-label]="label() ?? ('common.loading' | translate)"
    />
  `,
  styleUrl: './app-spinner.scss',
})
export class AppSpinner {
  readonly size = input<AppSpinnerSize>('md');
  readonly variant = input<AppSpinnerVariant>('crescent');
  /** Accessible status text; defaults to the translated "Loading…". */
  readonly label = input<string | null>(null);
}
