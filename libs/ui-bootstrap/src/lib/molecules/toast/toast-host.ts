import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Icon, type IconName } from '../../atoms/icon/icon.js';
import { IconButton } from '../../atoms/icon-button/icon-button.js';
import { ToastService, type Toast } from './toast.service.js';

const VARIANT_ICON: Record<Toast['variant'], IconName> = {
  success: 'check-circle',
  error: 'x-circle',
  warn: 'warning',
  info: 'info',
};

/**
 * Renders the toast stack. Mount once near the app root.
 *   <cdf-toast-host />
 */
@Component({
  selector: 'cdf-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, IconButton],
  template: `
    <div class="cdf-toast-host" aria-live="polite" aria-atomic="false">
      @for (t of toasts.items(); track t.id) {
      <div class="cdf-toast" [class]="'cdf-toast--' + t.variant" role="status">
        <cdf-icon class="cdf-toast__icon" [name]="iconFor(t.variant)" size="md" />
        <div class="cdf-toast__body">
          @if (t.title) {
          <strong class="cdf-toast__title">{{ t.title }}</strong>
          }
          <span class="cdf-toast__message">{{ t.message }}</span>
        </div>
        @if (t.actionLabel) {
        <button
          type="button"
          class="cdf-toast__action"
          (click)="onAction(t)"
        >
          {{ t.actionLabel }}
        </button>
        }
        <cdf-icon-button
          class="cdf-toast__dismiss"
          icon="x"
          size="sm"
          ariaLabel="Dismiss"
          kind="ghost"
          (click)="toasts.dismiss(t.id)"
        />
      </div>
      }
    </div>
  `,
  styleUrl: './toast-host.scss',
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);

  protected iconFor(variant: Toast['variant']): IconName {
    return VARIANT_ICON[variant];
  }

  protected onAction(t: Toast): void {
    t.onAction?.();
    this.toasts.dismiss(t.id);
  }
}
