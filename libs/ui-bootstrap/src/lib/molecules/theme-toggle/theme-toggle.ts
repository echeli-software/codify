import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';
import { ThemeService, type ThemeMode } from './theme.service.js';

/**
 * Three-state segmented control: light / dark / system. Reads + writes
 * `ThemeService` so multiple instances stay in sync.
 */
@Component({
  selector: 'cdf-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <fieldset
      class="cdf-theme-toggle"
      role="radiogroup"
      [attr.aria-label]="'common.theme.label' | translate"
    >
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="theme.mode() === 'light'"
        [class.cdf-theme-toggle__active]="theme.mode() === 'light'"
        (click)="set('light')"
      >
        <cdf-icon name="sun" size="sm" />
        {{ 'common.theme.light' | translate }}
      </button>
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="theme.mode() === 'dark'"
        [class.cdf-theme-toggle__active]="theme.mode() === 'dark'"
        (click)="set('dark')"
      >
        <cdf-icon name="moon" size="sm" />
        {{ 'common.theme.dark' | translate }}
      </button>
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="theme.mode() === 'system'"
        [class.cdf-theme-toggle__active]="theme.mode() === 'system'"
        (click)="set('system')"
      >
        {{ 'common.theme.system' | translate }}
      </button>
    </fieldset>
  `,
  styleUrl: './theme-toggle.scss',
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);

  protected set(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }
}
