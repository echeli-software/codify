import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Icon, type IconName } from '@codify/ui-ionic';
import {
  AppToastService,
  type AppToast,
  type AppToastKind,
} from './app-toast.service.js';

const ICONS: Record<AppToastKind, IconName> = {
  info: 'info-circle',
  success: 'check-circle',
  warning: 'warning',
  error: 'x-circle',
};

/**
 * Renders `AppToastService.toasts()` as a stack above the tab bar. Errors
 * are announced assertively (`role="alert"`), the rest politely.
 */
@Component({
  selector: 'cdf-app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <div class="toasts" aria-live="polite" data-testid="app-toasts">
      @for (t of toasts(); track t.id) {
        <div
          class="toast"
          [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          [attr.data-kind]="t.kind"
          data-testid="app-toast"
        >
          <cdf-icon [name]="icon(t)" size="sm" />
          <span class="toast__msg">{{ t.message | translate: t.params }}</span>
          @if (t.action; as action) {
            <button type="button" class="toast__action" (click)="run(t)">
              {{ action.label | translate }}
            </button>
          }
          <button
            type="button"
            class="toast__close"
            [attr.aria-label]="'common.close' | translate"
            (click)="toast.dismiss(t.id)"
          >
            <cdf-icon name="close" size="xs" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toasts {
        position: fixed;
        z-index: 40000;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
        width: min(560px, calc(100vw - 24px));
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }
      @media (min-width: 768px) {
        .toasts {
          bottom: 24px;
          left: calc(50% + 120px);
        }
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--cdf-color-surface-elev, #fff);
        color: var(--cdf-color-text, #111);
        border: 1px solid var(--cdf-color-border, #ddd);
        box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
        font-size: var(--cdf-font-size-sm, 14px);
      }
      .toast[data-kind='success'] {
        border-color: var(--cdf-color-success, #16a34a);
      }
      .toast[data-kind='warning'] {
        border-color: var(--cdf-color-warning, #f5b800);
      }
      .toast[data-kind='error'] {
        border-color: var(--cdf-color-danger, #dc2626);
      }
      .toast__msg {
        flex: 1;
      }
      .toast__action,
      .toast__close {
        background: none;
        border: 0;
        color: var(--cdf-color-primary, #2563eb);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
      }
      .toast__close {
        color: var(--cdf-color-text-muted, #666);
        display: inline-flex;
      }
      .toast__action:focus-visible,
      .toast__close:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
    `,
  ],
})
export class AppToastHost {
  protected readonly toast = inject(AppToastService);
  protected readonly toasts = this.toast.toasts;

  protected icon(t: AppToast): IconName {
    return ICONS[t.kind];
  }

  protected run(t: AppToast): void {
    try {
      t.action?.handler();
    } finally {
      this.toast.dismiss(t.id);
    }
  }
}
