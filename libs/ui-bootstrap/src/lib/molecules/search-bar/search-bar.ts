import {
  Component,
  ChangeDetectionStrategy,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';
import { IconButton } from '../../atoms/icon-button/icon-button.js';

/**
 * Search input with leading magnifier icon, trailing clear button, and
 * built-in debouncing. Emits `query` after `debounceMs` of inactivity.
 *
 *   <cdf-search-bar (query)="onSearch($event)" placeholder="Search courses…" />
 *
 * Use for any text-driven filter where firing on every keystroke is wasteful.
 */
@Component({
  selector: 'cdf-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, IconButton, TranslatePipe],
  template: `
    <div class="cdf-search">
      <cdf-icon class="cdf-search__leading" name="search" size="sm" />
      <input
        type="search"
        class="cdf-search__input"
        [placeholder]="placeholder()"
        [attr.aria-label]="
          ariaLabel() || placeholder() || ('common.search' | translate)
        "
        [(ngModel)]="value"
        (keydown.escape)="clear()"
      />
      @if (value()) {
        <cdf-icon-button
          class="cdf-search__clear"
          icon="x"
          size="sm"
          [ariaLabel]="'ui.search.clear' | translate"
          (click)="clear()"
        />
      }
    </div>
  `,
  styleUrl: './search-bar.scss',
})
export class SearchBar {
  readonly placeholder = input('');
  readonly ariaLabel = input<string | null>(null);
  readonly debounceMs = input(250);
  /** Current value, two-way bindable. */
  readonly value = signal('');
  /** Debounced query — emits after `debounceMs` of no further input. */
  readonly query = output<string>();

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const v = this.value();
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.query.emit(v), this.debounceMs());
    });
  }

  protected clear(): void {
    this.value.set('');
  }
}
