import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Button, Icon } from '@codify/ui-bootstrap';

/**
 * Typed error state for an async area (docs/04 §9): the resolved message
 * (from AdminErrors) plus a retry button.
 */
@Component({
  selector: 'cdf-load-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, TranslatePipe],
  template: `
    <div class="load-error" role="alert">
      <cdf-icon name="warning" />
      <span class="load-error__msg">{{ message() }}</span>
      <cdf-button kind="secondary" size="sm" (click)="retry.emit()">
        <cdf-icon name="arrow-clockwise" size="sm" />
        {{ 'admin.common.retry' | translate }}
      </cdf-button>
    </div>
  `,
  styles: [
    `
      .load-error {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-3);
        border: 1px solid var(--cdf-color-danger);
        border-radius: var(--cdf-radius-md);
        color: var(--cdf-color-danger);
        background: var(--cdf-color-surface);
      }
      .load-error__msg {
        flex: 1 1 200px;
        color: var(--cdf-color-text);
      }
    `,
  ],
})
export class LoadError {
  readonly message = input.required<string>();
  readonly retry = output<void>();
}
