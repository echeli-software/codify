import { Injectable, Injector, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { WebPushClient } from '@codify/api-client';
import { firstValueFrom, take, timeout } from 'rxjs';
import { NotificationsStore } from '../pages/notifications/notifications.store.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { isNativeRuntime } from './runtime.js';
import {
  pushDeepLink,
  pushNotificationId,
} from '../native/native-push.service.js';

/**
 * What this browser can do with web push:
 *   - `supported`: service worker + Push API + Notification API;
 *   - `ios-install`: iPhone / iPad Safari outside a home-screen web app —
 *     web push only works once Codify is added to the home screen
 *     (iOS 16.4+), so the app shows a hint instead of the toggle;
 *   - `unsupported`: no service worker / Push API (old browser, dev
 *     server, private mode in some browsers);
 *   - `native`: the Capacitor shell, which uses native FCM push.
 */
export type WebPushSupport =
  | 'supported'
  | 'ios-install'
  | 'unsupported'
  | 'native';

export type WebPushEnableResult =
  | 'enabled'
  /** The browser prompt was answered "Block" (or was blocked before). */
  | 'denied'
  /** Not supported here, or the server has web push off. */
  | 'unavailable'
  | 'error';

/** localStorage: when the "turn on browser notifications" card was dismissed. */
export const WEB_PUSH_DISMISSED_KEY = 'cdf.webPush.promptDismissedAt';

interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isIosDevice(nav: NavigatorLike | undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Running as an installed (home-screen / standalone) web app. */
export function isStandalone(
  win: { matchMedia?: (q: string) => { matches: boolean } } | undefined,
  nav: NavigatorLike | undefined,
): boolean {
  if (nav?.standalone === true) return true;
  try {
    return !!win?.matchMedia?.('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** Pure support check (tests pass their own globals). */
export function detectWebPushSupport(env: {
  native: boolean;
  swEnabled: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  ios: boolean;
  standalone: boolean;
}): WebPushSupport {
  if (env.native) return 'native';
  if (env.ios && !env.standalone) return 'ios-install';
  if (!env.swEnabled || !env.hasPushManager || !env.hasNotification)
    return 'unsupported';
  return 'supported';
}

/**
 * Browser web push for the PWA (docs/10 §3, docs/16): standard Web Push
 * with VAPID through Angular's service worker (`SwPush`) — the server
 * sends with `web-push`, so no Firebase SDK runs in the browser.
 *
 *   - `enable()` (only from a tap on our own explainer or the Settings
 *     toggle — never on load): server public key → `requestSubscription`
 *     (the browser's permission prompt) → POST /push/web/subscriptions.
 *   - `disable()`: DELETE the subscription on the server, then unsubscribe
 *     the browser.
 *   - `init()` (boot): taps on a web push while the app is open route in
 *     place and mark the inbox entry read (`SwPush.notificationClicks`);
 *     with the app closed, ngsw's `navigateLastFocusedOrOpen` opens it.
 *   - Sign-in re-binds an existing browser subscription to the user;
 *     sign-out removes it, so the next account here starts clean.
 *
 * Native (Capacitor) uses NativePushService instead — everything here is a
 * no-op there.
 */
@Injectable({ providedIn: 'root' })
export class WebPushService {
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly client = inject(WebPushClient);
  private readonly router = inject(Router);
  private readonly telemetry = inject(TelemetryService);
  private readonly injector = inject(Injector);

  private readonly _subscribed = signal(false);
  /** This browser has a web push subscription bound to the user. */
  readonly subscribed = this._subscribed.asReadonly();
  private readonly _permission =
    signal<NotificationPermission>(currentPermission());
  /** The browser's notification permission for this site. */
  readonly permission = this._permission.asReadonly();
  private initialized = false;
  private publicKeyP: Promise<string | null> | null = null;

  support(): WebPushSupport {
    const g = globalThis as {
      navigator?: NavigatorLike;
      matchMedia?: (q: string) => { matches: boolean };
      PushManager?: unknown;
      Notification?: unknown;
    };
    return detectWebPushSupport({
      native: isNativeRuntime(),
      swEnabled: !!this.swPush?.isEnabled,
      hasPushManager: typeof g.PushManager !== 'undefined',
      hasNotification: typeof g.Notification !== 'undefined',
      ios: isIosDevice(g.navigator),
      standalone: isStandalone(g, g.navigator),
    });
  }

  /** Attach the notification-click router (idempotent). */
  init(): void {
    if (this.initialized || this.support() !== 'supported' || !this.swPush)
      return;
    this.initialized = true;
    this.swPush.notificationClicks.subscribe(({ notification }) =>
      this.openFromNotification(notification?.data),
    );
    this.swPush.subscription.subscribe((sub) => this._subscribed.set(!!sub));
  }

  /**
   * Should the app offer its "turn on browser notifications" card now?
   * Web only, supported, the browser hasn't decided yet ("default") or
   * allowed without a subscription, not dismissed, server has web push.
   */
  async canOffer(): Promise<boolean> {
    if (this.support() !== 'supported') return false;
    this._permission.set(currentPermission());
    if (this._permission() === 'denied') return false;
    if (await this.currentSubscription()) return false;
    if (readDismissed()) return false;
    return (await this.publicKey()) !== null;
  }

  /** The user said "Not now" on the card: don't offer it again. */
  dismissOffer(): void {
    try {
      localStorage.setItem(WEB_PUSH_DISMISSED_KEY, new Date().toISOString());
    } catch {
      // Private mode: the card may come back next time — harmless.
    }
    this.telemetry.track('web_push_prompt_dismissed');
  }

  /** Subscribe this browser. Call only from a user gesture (a tap). */
  async enable(source: 'prompt' | 'settings'): Promise<WebPushEnableResult> {
    if (this.support() !== 'supported' || !this.swPush) return 'unavailable';
    const key = await this.publicKey();
    if (!key) return 'unavailable';
    let sub: PushSubscription;
    try {
      sub = await this.swPush.requestSubscription({ serverPublicKey: key });
    } catch (err) {
      this._permission.set(currentPermission());
      const denied = this._permission() === 'denied';
      this.telemetry.track(
        denied ? 'push_permission_denied' : 'push_registration_failed',
        { platform: 'WEB', source },
      );
      if (!denied) console.warn('[web-push] subscription failed', err);
      return denied ? 'denied' : 'error';
    }
    this._permission.set(currentPermission());
    try {
      await this.bind(sub);
    } catch {
      // The browser is subscribed but the server doesn't know it: undo so
      // the toggle doesn't claim notifications that will never come.
      await sub.unsubscribe().catch(() => false);
      this._subscribed.set(false);
      return 'error';
    }
    this.telemetry.track('push_registered', { platform: 'WEB', source });
    return 'enabled';
  }

  /** Unsubscribe this browser (server row first, while still signed in). */
  async disable(): Promise<void> {
    const sub = await this.currentSubscription();
    if (!sub) {
      this._subscribed.set(false);
      return;
    }
    await this.client.unsubscribe(sub.endpoint).catch(() => undefined);
    try {
      await this.swPush?.unsubscribe();
    } catch {
      await sub.unsubscribe().catch(() => false);
    }
    this._subscribed.set(false);
  }

  /** Sign-in: re-bind an existing browser subscription to this user. */
  async onSignedIn(): Promise<void> {
    if (this.support() !== 'supported') return;
    const sub = await this.currentSubscription();
    if (!sub) return;
    await this.bind(sub).catch(() => undefined);
  }

  /** Sign-out: the next account on this browser starts without it. */
  async onSignedOut(): Promise<void> {
    if (this.support() !== 'supported') return;
    await this.disable();
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async bind(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON();
    const p256dh = json.keys?.['p256dh'];
    const auth = json.keys?.['auth'];
    if (!json.endpoint || !p256dh || !auth) throw new Error('bad subscription');
    await this.client.subscribe({
      endpoint: json.endpoint,
      keys: { p256dh, auth },
    });
    this._subscribed.set(true);
  }

  private publicKey(): Promise<string | null> {
    if (!this.publicKeyP) {
      this.publicKeyP = this.client
        .config()
        .then((c) => c.publicKey || null)
        .catch(() => {
          // 404 WEB_PUSH_DISABLED or offline: try again next time.
          this.publicKeyP = null;
          return null;
        });
    }
    return this.publicKeyP;
  }

  private async currentSubscription(): Promise<PushSubscription | null> {
    if (!this.swPush?.isEnabled) return null;
    try {
      return await firstValueFrom(
        this.swPush.subscription.pipe(take(1), timeout(3000)),
      );
    } catch {
      return null;
    }
  }

  private openFromNotification(data: unknown): void {
    const payload = { data: (data ?? {}) as Record<string, unknown> };
    const inboxId = pushNotificationId(payload);
    if (inboxId)
      void this.injector.get(NotificationsStore).markReadFromPush(inboxId);
    const route = pushDeepLink(payload);
    this.telemetry.track('push_opened', { hasUrl: !!route, platform: 'WEB' });
    if (route) void this.router.navigateByUrl(route);
  }
}

function currentPermission(): NotificationPermission {
  try {
    const N = (globalThis as { Notification?: { permission?: string } })
      .Notification;
    const p = N?.permission;
    return p === 'granted' || p === 'denied' ? p : 'default';
  } catch {
    return 'default';
  }
}

function readDismissed(): boolean {
  try {
    return !!localStorage.getItem(WEB_PUSH_DISMISSED_KEY);
  } catch {
    return false;
  }
}
