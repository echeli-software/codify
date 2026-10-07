import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';

@Component({
  selector: 'cdf-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <span
      class="cdf-spinner"
      [class]="cssClass()"
      role="status"
      [attr.aria-label]="label() ?? ('common.loading' | translate)"
    >
      <span class="visually-hidden">{{
        label() ?? ('common.loading' | translate)
      }}</span>
    </span>
  `,
  styleUrl: './spinner.scss',
})
export class Spinner {
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  /** Accessible status text; defaults to the translated "Loading…". */
  readonly label = input<string | null>(null);

  protected readonly cssClass = computed(() => `cdf-spinner--${this.size()}`);
}
