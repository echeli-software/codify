import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Wraps `navigator.onLine` + the window `online`/`offline` events into
 * a signal so components react reactively to connectivity changes.
 *
 * Caveats per /docs/16-offline:
 *   - `navigator.onLine === true` does NOT guarantee reachable internet;
 *     it just means we have a network interface. We treat it as a hint;
 *     a failed fetch will still surface as a queue retry.
 *   - In the Capacitor mobile build we'll override this with the
 *     Network plugin; for now web-only is fine.
 */
@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly _online = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  /** Reactive read-only signal of current connectivity. */
  readonly online = this._online.asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;
    const onOnline = () => this._online.set(true);
    const onOffline = () => this._online.set(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });
  }

  /** Test/probe escape hatch — flip the signal manually. */
  forceOnline(v: boolean): void {
    this._online.set(v);
  }
}
