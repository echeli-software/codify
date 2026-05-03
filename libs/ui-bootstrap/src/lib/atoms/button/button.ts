import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonType = 'button' | 'submit' | 'reset';

@Component({
  selector: 'cdf-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() || null"
      [class]="cssClass()"
    >
      @if (loading()) {
      <span class="cdf-button__spinner" aria-hidden="true"></span>
      }
      <ng-content />
    </button>
  `,
  styleUrl: './button.scss',
})
export class Button {
  readonly kind = input<ButtonKind>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<ButtonType>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly fullWidth = input(false);

  protected readonly cssClass = computed(() => {
    const k = this.kind();
    const s = this.size();
    const cls = ['btn', `cdf-button`, `cdf-button--${k}`];
    if (s !== 'md') cls.push(`cdf-button--${s}`);
    if (this.fullWidth()) cls.push('cdf-button--full');
    if (this.loading()) cls.push('cdf-button--loading');
    return cls.join(' ');
  });
}
