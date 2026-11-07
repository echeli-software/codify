import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isNativeRuntime } from '../platform/runtime.js';

/** Physical link type; `unknown` when the platform can't tell (desktop web). */
export type ConnectionType =
  | 'wifi'
  | 'cellular'
  | 'ethernet'
  | 'none'
  | 'unknown';

interface NavigatorConnection extends EventTarget {
  type?: string;
}

/**
 * Connectivity as signals (docs/16 §4 "Coming back online").
 *
 *   - Web: `navigator.onLine` + `online`/`offline` events; the link type
 *     comes from `navigator.connection.type` where the browser exposes it
 *     (Chrome on Android), `unknown` elsewhere.
 *   - Native: the Capacitor Network plugin (`connectionType` +
 *     `networkStatusChange`), which also reports Wi-Fi vs cellular on iOS.
 *
 * `navigator.onLine === true` does not guarantee the API is reachable; it's
 * a hint — failed requests still go through the sync queue's backoff.
 */
@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly _online = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  private readonly _type = signal<ConnectionType>(webConnectionType());

  /** Reactive read-only signal of current connectivity. */
  readonly online = this._online.asReadonly();
  /** Wi-Fi / cellular / … (see class doc). */
  readonly connectionType = this._type.asReadonly();
  /** True on a metered (cellular) link — Wi-Fi-only downloads pause. */
  readonly metered = computed(() => this._type() === 'cellular');

  constructor() {
    if (typeof window === 'undefined') return;
    const destroyRef = inject(DestroyRef);
    const onOnline = () => {
      this._online.set(true);
      this._type.set(webConnectionType());
    };
    const onOffline = () => {
      this._online.set(false);
      this._type.set('none');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const conn = (navigator as { connection?: NavigatorConnection }).connection;
    const onChange = () => this._type.set(webConnectionType());
    conn?.addEventListener?.('change', onChange);
    destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      conn?.removeEventListener?.('change', onChange);
    });
    if (isNativeRuntime()) void this.attachNative(destroyRef);
  }

  /** Re-read the browser's connectivity hint (manual "Try again"). */
  recheck(): void {
    if (typeof navigator === 'undefined') return;
    this._online.set(navigator.onLine);
    if (navigator.onLine) this._type.set(webConnectionType());
  }

  /** Test/probe escape hatch — flip the signal manually. */
  forceOnline(v: boolean): void {
    this._online.set(v);
  }

  /** Test/probe escape hatch — pretend the link is Wi-Fi / cellular. */
  forceConnectionType(type: ConnectionType): void {
    this._type.set(type);
  }

  private async attachNative(destroyRef: DestroyRef): Promise<void> {
    try {
      const { Network } = await import('@capacitor/network');
      const apply = (s: { connected: boolean; connectionType: string }) => {
        this._online.set(s.connected);
        this._type.set(normalize(s.connectionType));
      };
      apply(await Network.getStatus());
      const handle = await Network.addListener('networkStatusChange', apply);
      destroyRef.onDestroy(() => void handle.remove());
    } catch {
      /* plugin missing in this shell: keep the web signals */
    }
  }
}

function normalize(type: string | undefined): ConnectionType {
  switch (type) {
    case 'wifi':
    case 'cellular':
    case 'ethernet':
    case 'none':
      return type;
    case 'wimax':
      return 'cellular';
    default:
      return 'unknown';
  }
}

function webConnectionType(): ConnectionType {
  if (typeof navigator === 'undefined') return 'unknown';
  if (!navigator.onLine) return 'none';
  const conn = (navigator as { connection?: NavigatorConnection }).connection;
  return normalize(conn?.type);
}
