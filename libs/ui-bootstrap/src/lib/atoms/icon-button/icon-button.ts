import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { Icon, type IconName } from '../icon/icon.js';
import type { ButtonKind, ButtonSize } from '../button/button.js';

/**
 * Icon-only button. Mandatory `aria-label` for accessibility.
 * For text + icon, use `<cdf-button>` directly with an `<cdf-icon>` child.
 */
@Component({
  selector: 'cdf-icon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button
      type="button"
      [class]="cssClass()"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-pressed]="pressed() ?? null"
    >
      <cdf-icon [name]="icon()" [size]="iconSize()" />
    </button>
  `,
  styleUrl: './icon-button.scss',
})
export class IconButton {
  readonly icon = input.required<IconName>();
  readonly ariaLabel = input.required<string>();
  readonly kind = input<ButtonKind>('ghost');
  readonly size = input<ButtonSize>('md');
  readonly disabled = input(false);
  /** Optional toggle state (for buttons that toggle on/off). */
  readonly pressed = input<boolean | null>(null);

  protected readonly iconSize = computed<'sm' | 'md' | 'lg'>(() => {
    const s = this.size();
    if (s === 'sm') return 'sm';
    if (s === 'lg') return 'lg';
    return 'md';
  });

  protected readonly cssClass = computed(() => {
    const cls = ['cdf-icon-button', `cdf-icon-button--${this.kind()}`, `cdf-icon-button--${this.size()}`];
    if (this.pressed() === true) cls.push('cdf-icon-button--pressed');
    return cls.join(' ');
  });
}
