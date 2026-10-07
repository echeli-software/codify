import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';

export type ProgressBarVariant =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'xp';
export type ProgressBarSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'cdf-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div
      class="cdf-progress"
      [class]="cssClass()"
      role="progressbar"
      [attr.aria-label]="label() ?? ('ui.progress.label' | translate)"
      [attr.aria-valuenow]="indeterminate() ? null : pct()"
      [attr.aria-valuemin]="indeterminate() ? null : 0"
      [attr.aria-valuemax]="indeterminate() ? null : 100"
    >
      <div
        class="cdf-progress__bar"
        [style.width.%]="indeterminate() ? null : pct()"
      ></div>
    </div>
  `,
  styleUrl: './progress-bar.scss',
})
export class ProgressBar {
  /** 0–100 percent. Clamped. Ignored when `indeterminate=true`. */
  readonly value = input(0);
  readonly variant = input<ProgressBarVariant>('primary');
  readonly size = input<ProgressBarSize>('md');
  readonly indeterminate = input(false);
  readonly label = input<string | null>(null);

  protected readonly pct = computed(() => {
    const v = this.value();
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 100) return 100;
    return v;
  });

  protected readonly cssClass = computed(() => {
    const cls = [
      `cdf-progress--${this.variant()}`,
      `cdf-progress--${this.size()}`,
    ];
    if (this.indeterminate()) cls.push('cdf-progress--indeterminate');
    return cls.join(' ');
  });
}
