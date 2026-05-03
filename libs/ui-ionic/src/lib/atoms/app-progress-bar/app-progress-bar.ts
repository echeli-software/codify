import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { IonProgressBar } from '@ionic/angular/standalone';

export type AppProgressBarVariant = 'primary' | 'success' | 'warning' | 'danger' | 'xp';
export type AppProgressBarSize = 'sm' | 'md' | 'lg';

const VARIANT_TO_COLOR: Record<AppProgressBarVariant, string> = {
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  xp: 'primary', // styled separately via host attr — see SCSS
};

/**
 * Branded progress bar. Wraps <ion-progress-bar> with our variant + size
 * taxonomy and an `xp` accent that uses the indigo→violet gradient from
 * the design tokens (matches XpBadge / RewardOrchestrator visuals).
 */
@Component({
  selector: 'cdf-app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonProgressBar],
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
  },
  template: `
    <ion-progress-bar
      [value]="indeterminate() ? null : fraction()"
      [type]="indeterminate() ? 'indeterminate' : 'determinate'"
      [color]="ionColor()"
      role="progressbar"
      [attr.aria-label]="label()"
      [attr.aria-valuemin]="indeterminate() ? null : 0"
      [attr.aria-valuemax]="indeterminate() ? null : 100"
      [attr.aria-valuenow]="indeterminate() ? null : pct()"
    />
  `,
  styleUrl: './app-progress-bar.scss',
})
export class AppProgressBar {
  /** 0–100 percent. Clamped. Ignored when `indeterminate=true`. */
  readonly value = input(0);
  readonly variant = input<AppProgressBarVariant>('primary');
  readonly size = input<AppProgressBarSize>('md');
  readonly indeterminate = input(false);
  readonly label = input<string | null>(null);

  protected readonly pct = computed(() => {
    const v = this.value();
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 100) return 100;
    return v;
  });

  protected readonly fraction = computed(() => this.pct() / 100);
  protected ionColor(): string {
    return VARIANT_TO_COLOR[this.variant()];
  }
}
