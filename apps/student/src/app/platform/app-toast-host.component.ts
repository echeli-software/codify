import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import {
  AppToastService,
  type AppToast,
  type AppToastKind,
} from './app-toast.service.js';

/** Inline SVG paths (24×24) — no icon library in the initial bundle. */
const ICONS: Record<AppToastKind, string> = {
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2Zm0-8h-2V7h2Z',
  success:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.5 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4Z',
  warning: 'M1 21h22L12 2Zm12-3h-2v-2h2Zm0-4h-2v-4h2Z',
  error:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.3 12.9-1.4 1.4L12 13.4l-2.9 2.9-1.4-1.4 2.9-2.9-2.9-2.9 1.4-1.4 2.9 2.9 2.9-2.9 1.4 1.4-2.9 2.9Z',
};
const CLOSE =
  'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3Z';

/**
 * Renders `AppToastService.toasts()` as a stack above the tab bar. Errors
 * are announced assertively (`role="alert"`), the rest politely.
 */
@Component({
  selector: 'cdf-app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="toasts" aria-live="polite" data-testid="app-toasts">
      @for (t of toasts(); track t.id) {
        <div
          class="toast"
          [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          [attr.data-kind]="t.kind"
          data-testid="app-toast"
        >
          <svg
            class="toast__icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path [attr.d]="icon(t)" />
          </svg>
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
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path [attr.d]="closePath" />
            </svg>
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
        min-width: 0;
      }
      .toast__icon {
        width: 20px;
        height: 20px;
        flex: none;
        fill: var(--cdf-color-primary, #2563eb);
      }
      .toast[data-kind='success'] .toast__icon {
        fill: var(--cdf-color-success, #16a34a);
      }
      .toast[data-kind='warning'] .toast__icon {
        fill: var(--cdf-color-warning, #d97706);
      }
      .toast[data-kind='error'] .toast__icon {
        fill: var(--cdf-color-danger, #dc2626);
      }
      .toast__close svg {
        fill: currentColor;
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

  protected readonly closePath = CLOSE;

  protected icon(t: AppToast): string {
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
