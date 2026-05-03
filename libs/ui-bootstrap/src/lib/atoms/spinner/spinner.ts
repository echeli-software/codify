import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

@Component({
  selector: 'cdf-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cdf-spinner" [class]="cssClass()" role="status" [attr.aria-label]="label()">
      <span class="visually-hidden">{{ label() }}</span>
    </span>
  `,
  styleUrl: './spinner.scss',
})
export class Spinner {
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly label = input('Loading…');

  protected readonly cssClass = computed(() => `cdf-spinner--${this.size()}`);
}
