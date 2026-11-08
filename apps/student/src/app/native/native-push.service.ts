import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  DevicesClient,
  toProblemDetails,
  type DevicePlatform,
} from '@codify/api-client';
import { safeRedirect } from '@codify/auth';
import type {
  FirebaseMessagingPlugin,
  Notification as PushNotification,
} from '@capacitor-firebase/messaging';
import { NotificationsStore } from '../pages/notifications/notifications.store.js';
import { AppToastService } from '../platform/app-toast.service.js';
import { isNativeRuntime, runtimePlatform } from '../platform/runtime.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/** Payload keys that may carry the in-app route, in priority order. */
const DEEP_LINK_KEYS = ['deepLink', 'url', 'route', 'link'] as const;

/**
 * The in-app route a push should open, or null. Reads the API's data
 * payload (`deepLink` / `url` / `route`, see NotificationService) and the
 * FCM `link`; only app-relative paths — or absolute URLs on the app's own
 * origin — are accepted (docs/14: deep links are allowlisted).
 */
export function pushDeepLink(
  notification: Pick<PushNotification, 'data' | 'link'> | null | undefined,
  origin: string = globalThis.location?.origin ?? '',
): string | null {
  const data = (notification?.data ?? {}) as Record<string, unknown>;
  const candidates = [
    ...DEEP_LINK_KEYS.map((k) => data[k]),
    notification?.link,
  ];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    let path = c;
    if (/^https?:\/\//i.test(c)) {
      try {
        const u = new URL(c);
        if (!origin || u.origin !== origin) continue;
        path = `${u.pathname}${u.search}${u.hash}`;
      } catch {
        continue;
      }
    }
    const safe = safeRedirect(path, '');
    if (safe) return safe;
  }
  return null;
}

/**
 * The inbox entry a push belongs to (`data.notificationId`, set by the
 * API's NotificationService for kinds that also land in the inbox), or null.
 */
export function pushNotificationId(
  notification: Pick<PushNotification, 'data'> | null | undefined,
): string | null {
  const id = (notification?.data as Record<string, unknown> | undefined)?.[
    'notificationId'
  ];
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}

/**
 * Native push through Firebase Cloud Messaging on **both** iOS and Android
 * (`@capacitor-firebase/messaging`, docs/17). The token registered with
 * `POST /devices` is always an FCM registration token, which is what the
 * API's `FcmPushProvider` delivers to (iOS via FCM's APNs bridge).
 *
 *   - `init()` (boot): listeners for taps (deep link, also on cold start),
 *     foreground messages (in-app toast on Android; iOS shows the banner
 *     itself via `presentationOptions`) and token refresh.
 *   - `register()` (after sign-in): permission prompt → `getToken` →
 *     `POST /devices` (retry once on 409 `device.rebind_required`).
 *   - `unregister()` (sign-out): `DELETE /devices/:token` + `deleteToken`
 *     so the next account on this device gets a fresh token.
 *
 * The plugin is registered by name with `@capacitor/core` (types only from
 * the package) so its web implementation — and the Firebase JS SDK it
 * needs — never enter the web bundle. No-op on the web.
 */
@Injectable({ providedIn: 'root' })
export class NativePushService {
  private readonly devices = inject(DevicesClient);
  private readonly router = inject(Router);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  // Resolved on first tap only, so the push service stays cheap at boot.
  private readonly injector = inject(Injector);

  private pluginP: Promise<FirebaseMessagingPlugin | null> | null = null;
  private listenersP: Promise<void> | null = null;
  private signedIn = false;
  private _token: string | null = null;

  /** The FCM token currently bound to the signed-in user, if any. */
  get token(): string | null {
    return this._token;
  }

  /** Attach tap / foreground / token-refresh listeners (idempotent). */
  init(): Promise<void> {
    if (!isNativeRuntime()) return Promise.resolve();
    if (!this.listenersP) {
      this.listenersP = this.addListeners().catch(() => {
        this.listenersP = null;
      });
    }
    return this.listenersP;
  }

  /**
   * Ask for permission (first time only — the OS remembers the answer),
   * fetch the FCM token and bind it to the signed-in user.
   */
  async register(): Promise<boolean> {
    if (!isNativeRuntime()) return false;
    this.signedIn = true;
    try {
      const messaging = await this.plugin();
      if (!messaging) return false;
      await this.init();
      let perm = await messaging.checkPermissions();
      if (perm.receive !== 'granted' && perm.receive !== 'denied')
        perm = await messaging.requestPermissions();
      if (perm.receive !== 'granted') {
        this.telemetry.track('push_permission_denied', {
          platform: this.platform(),
        });
        return false;
      }
      const { token } = await messaging.getToken();
      if (!token) return false;
      if (token === this._token) return true;
      return await this.bindToken(token);
    } catch (err) {
      this.telemetry.track('push_registration_failed', {
        error: String((err as Error)?.message ?? err ?? ''),
      });
      return false;
    }
  }

  /**
   * Remote push permission without prompting: `unavailable` on the web or
   * when the plugin is missing (then local reminders are the fallback).
   */
  async permission(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
    if (!isNativeRuntime()) return 'unavailable';
    try {
      const messaging = await this.plugin();
      if (!messaging) return 'unavailable';
      const perm = await messaging.checkPermissions();
      if (perm.receive === 'granted') return 'granted';
      if (perm.receive === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unavailable';
    }
  }

  /** Unbind this device from the user and drop the FCM token. */
  async unregister(): Promise<void> {
    this.signedIn = false;
    const token = this._token;
    this._token = null;
    if (!isNativeRuntime()) return;
    if (token) await this.devices.unregister(token).catch(() => undefined);
    const messaging = await this.plugin();
    await messaging?.deleteToken().catch(() => undefined);
  }

  /** POST /devices; on 409 `device.rebind_required` register once more. */
  async bindToken(token: string): Promise<boolean> {
    const platform = this.platform();
    try {
      await this.devices.register(token, platform);
    } catch (err) {
      const p = toProblemDetails(err);
      if (p.status !== 409 || p.code !== 'device.rebind_required') return false;
      try {
        await this.devices.register(token, platform);
      } catch {
        return false;
      }
    }
    this._token = token;
    this.telemetry.track('push_registered', { platform });
    return true;
  }

  /**
   * A notification was tapped: mark its inbox entry read (fire-and-forget;
   * the store refreshes the bell) and open the route it points at.
   */
  openFromNotification(notification: PushNotification | undefined): void {
    const inboxId = pushNotificationId(notification);
    if (inboxId)
      void this.injector.get(NotificationsStore).markReadFromPush(inboxId);
    const route = pushDeepLink(notification);
    this.telemetry.track('push_opened', { hasUrl: !!route });
    if (route) void this.router.navigateByUrl(route);
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private platform(): DevicePlatform {
    const p = runtimePlatform();
    return p === 'ios' ? 'IOS' : p === 'android' ? 'ANDROID' : 'WEB';
  }

  private plugin(): Promise<FirebaseMessagingPlugin | null> {
    if (!this.pluginP) {
      this.pluginP = import('@capacitor/core')
        .then((m) =>
          m.registerPlugin<FirebaseMessagingPlugin>('FirebaseMessaging'),
        )
        .catch(() => null);
    }
    return this.pluginP;
  }

  private async addListeners(): Promise<void> {
    const messaging = await this.plugin();
    if (!messaging) return;
    await messaging.addListener('notificationActionPerformed', (e) =>
      this.openFromNotification(e.notification),
    );
    await messaging.addListener('notificationReceived', (e) =>
      this.onForeground(e.notification),
    );
    await messaging.addListener('tokenReceived', (e) => {
      void this.onTokenRefresh(e.token);
    });
  }

  /** FCM rotated the token: bind the new one, then drop the old binding. */
  private async onTokenRefresh(token: string | undefined): Promise<void> {
    if (!this.signedIn || !token || token === this._token) return;
    const previous = this._token;
    if ((await this.bindToken(token)) && previous) {
      await this.devices.unregister(previous).catch(() => undefined);
    }
  }

  /**
   * A message arrived while the app is open. iOS presents the banner itself
   * (capacitor.config `presentationOptions`); Android doesn't, so show it
   * in-app with an "Open" action when it carries a deep link.
   */
  private onForeground(notification: PushNotification | undefined): void {
    this.telemetry.track('push_received_foreground', {
      platform: this.platform(),
    });
    if (runtimePlatform() !== 'android' || !notification) return;
    const text = [notification.title, notification.body]
      .filter((s): s is string => !!s)
      .join(' — ');
    if (!text) return;
    const route = pushDeepLink(notification);
    this.toast.show({
      message: text,
      kind: 'info',
      durationMs: 6000,
      ...(route
        ? {
            action: {
              label: 'studentPlatform.push.open',
              handler: () => this.openFromNotification(notification),
            },
          }
        : {}),
    });
  }
}
