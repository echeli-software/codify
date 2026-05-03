import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'success' | 'error' | 'info' | 'warn';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title?: string;
  message: string;
  durationMs: number;
  /** Optional action label rendered as a button in the toast. */
  actionLabel?: string;
  onAction?: () => void;
}

interface ShowOptions {
  title?: string;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

const DEFAULT_DURATION = 4000;

/**
 * App-wide toast notifications. Fired imperatively from any service or
 * component. Use a single `<cdf-toast-host />` mounted near the app root
 * (typically inside the AppShell organism).
 *
 *   toasts.success('Course saved');
 *   toasts.error('Could not connect', { actionLabel: 'Retry', onAction: ... });
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly _items = signal<Toast[]>([]);
  readonly items = this._items.asReadonly();

  success(message: string, opts: ShowOptions = {}): number {
    return this.show('success', message, opts);
  }
  error(message: string, opts: ShowOptions = {}): number {
    return this.show('error', message, opts);
  }
  info(message: string, opts: ShowOptions = {}): number {
    return this.show('info', message, opts);
  }
  warn(message: string, opts: ShowOptions = {}): number {
    return this.show('warn', message, opts);
  }

  dismiss(id: number): void {
    this._items.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this._items.set([]);
  }

  private show(variant: ToastVariant, message: string, opts: ShowOptions): number {
    const id = this.nextId++;
    const toast: Toast = {
      id,
      variant,
      message,
      title: opts.title,
      durationMs: opts.durationMs ?? DEFAULT_DURATION,
      actionLabel: opts.actionLabel,
      onAction: opts.onAction,
    };
    this._items.update((list) => [...list, toast]);
    if (toast.durationMs > 0) {
      setTimeout(() => this.dismiss(id), toast.durationMs);
    }
    return id;
  }
}
