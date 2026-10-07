import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular/standalone';
import {
  DevicesClient,
  toProblemDetails,
  type DevicePlatform,
} from '@codify/api-client';
import { safeRedirect } from '@codify/auth';
import type { PurchasesPlugin } from '@revenuecat/purchases-capacitor';
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from '../api-base-url.js';
import { isNativeRuntime, runtimePlatform } from '../platform/runtime.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/** Thrown when a plan price has no App Store / Play product configured. */
export class StoreProductMissingError extends Error {
  constructor() {
    super('This plan is not sold in the app store yet');
    this.name = 'StoreProductMissingError';
  }
}

/**
 * Bridge to the Capacitor native shell (Phase 11, docs/17). Everything
 * degrades to a safe no-op on the web, so the same build runs as a PWA and
 * inside the iOS/Android shell. Native plugins are loaded with plain dynamic
 * `import()` only when running natively, so they live in lazy chunks the
 * web never executes.
 *
 *   - Push: permission → register → POST /devices (retries once on 409
 *     `device.rebind_required`, the server's anti-hijack handshake);
 *     notification taps deep-link to their in-app `url`.
 *   - RevenueCat: `configure` with the per-store key from the build define,
 *     `logIn(userId)` after sign-in / `logOut` on sign-out, purchases by the
 *     price's `storeProductId`, restore.
 *   - Android hardware back button (exit at the root) + app foreground state.
 *
 * NOTE: iOS push here goes through APNs via @capacitor/push-notifications;
 * delivering FCM messages to iOS needs `@capacitor-firebase/messaging`
 * (not installed) — see the mobile runbook.
 */
@Injectable({ providedIn: 'root' })
export class NativePlatformService {
  private readonly devices = inject(DevicesClient);
  private readonly router = inject(Router);
  private readonly ionic = inject(Platform);
  private readonly telemetry = inject(TelemetryService);

  private registeredToken: string | null = null;
  private pushListenersAdded = false;
  private purchasesP: Promise<PurchasesPlugin | null> | null = null;
  private rcConfigured = false;
  private rcUserId: string | null = null;
  private initialized = false;

  private readonly _appActive = signal(true);
  /** False while the native app is in the background. */
  readonly appActive = this._appActive.asReadonly();

  /** True only inside the Capacitor shell. */
  get isNative(): boolean {
    return isNativeRuntime();
  }

  /** 'IOS' | 'ANDROID' | 'WEB' — the device-token platform tag. */
  platform(): DevicePlatform {
    const p = runtimePlatform();
    return p === 'ios' ? 'IOS' : p === 'android' ? 'ANDROID' : 'WEB';
  }

  /** True when this build can sell through the store (native + RevenueCat key). */
  get storePurchasesAvailable(): boolean {
    return this.isNative && !!this.revenueCatKey();
  }

  /** Install back-button + app-state hooks (call once at boot). */
  async init(): Promise<void> {
    if (this.initialized || !this.isNative) return;
    this.initialized = true;
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('appStateChange', ({ isActive }) => {
        this._appActive.set(isActive);
        this.telemetry.track(
          isActive ? 'app_foregrounded' : 'app_backgrounded',
        );
        if (!isActive) void this.telemetry.flush();
      });
      // Lowest priority: Ionic closes overlays / pops the nav stack first;
      // only at the root does the back button leave the app.
      this.ionic.backButton.subscribeWithPriority(-1, () => {
        if (window.history.length > 1 && this.router.url !== '/today') {
          window.history.back();
        } else {
          void App.exitApp();
        }
      });
    } catch {
      /* @capacitor/app missing in this shell */
    }
  }

  // ─── Session hooks ──────────────────────────────────────────────────────

  /** After sign-in: identify the RevenueCat customer + register for push. */
  async onSignedIn(userId: string): Promise<void> {
    if (!this.isNative) return;
    await this.identifyPurchases(userId);
    await this.registerForPush();
  }

  /** On sign-out: unbind the push token and reset the RevenueCat customer. */
  async onSignedOut(): Promise<void> {
    if (!this.isNative) return;
    const token = this.registeredToken;
    this.registeredToken = null;
    if (token) await this.devices.unregister(token).catch(() => undefined);
    if (this.rcConfigured && this.rcUserId) {
      const Purchases = await this.purchases();
      await Purchases?.logOut().catch(() => undefined);
      this.rcUserId = null;
    }
  }

  // ─── Push ───────────────────────────────────────────────────────────────

  /**
   * Request push permission, register with APNs/FCM, and POST the resulting
   * token to /devices. No-op on web.
   */
  async registerForPush(): Promise<void> {
    if (!this.isNative) return;
    try {
      const { PushNotifications } =
        await import('@capacitor/push-notifications');
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;
      if (!this.pushListenersAdded) {
        this.pushListenersAdded = true;
        await PushNotifications.addListener('registration', (t) => {
          if (t.value && t.value !== this.registeredToken)
            void this.bindToken(t.value);
        });
        await PushNotifications.addListener('registrationError', (e) => {
          this.telemetry.track('push_registration_failed', {
            error: String(e?.error ?? ''),
          });
        });
        await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (a) => {
            const url = (a.notification?.data as { url?: unknown } | undefined)
              ?.url;
            this.telemetry.track('push_opened', {
              hasUrl: typeof url === 'string',
            });
            if (typeof url === 'string') {
              void this.router.navigateByUrl(safeRedirect(url, '/today'));
            }
          },
        );
      }
      await PushNotifications.register();
    } catch {
      /* push unavailable in this shell */
    }
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
    this.registeredToken = token;
    this.telemetry.track('push_registered', { platform });
    return true;
  }

  // ─── RevenueCat ─────────────────────────────────────────────────────────

  /**
   * Buy a plan price through the store. Uses the price's App Store / Play
   * `storeProductId`; throws `StoreProductMissingError` when it has none.
   * Resolves true when an entitlement became active, false if the user
   * cancelled. The entitlement syncs to our Subscription via the
   * RevenueCat webhook.
   */
  purchasePrice(price: { storeProductId: string | null }): Promise<boolean> {
    if (!price.storeProductId)
      return Promise.reject(new StoreProductMissingError());
    return this.purchaseProduct(price.storeProductId);
  }

  /** Buy a store product by its identifier (App Store / Play product id). */
  async purchaseProduct(storeProductId: string): Promise<boolean> {
    if (!this.isNative)
      throw new Error('IAP is only available in the mobile app');
    const Purchases = await this.purchases();
    if (!Purchases) throw new Error('Store purchases unavailable');
    const { products } = await Purchases.getProducts({
      productIdentifiers: [storeProductId],
    });
    const product = products.find((p) => p.identifier === storeProductId);
    if (!product) throw new StoreProductMissingError();
    this.telemetry.track('iap_purchase_started', { productId: storeProductId });
    try {
      const res = await Purchases.purchaseStoreProduct({ product });
      const ok =
        Object.keys(res.customerInfo?.entitlements?.active ?? {}).length > 0;
      this.telemetry.track('iap_purchase_completed', {
        productId: storeProductId,
        entitled: ok,
      });
      return ok;
    } catch (err) {
      if ((err as { userCancelled?: boolean })?.userCancelled) {
        this.telemetry.track('iap_purchase_cancelled', {
          productId: storeProductId,
        });
        return false;
      }
      throw err;
    }
  }

  /**
   * @deprecated pass the price (`purchasePrice`) — this takes the store
   * product id, never our plan/price UUID.
   */
  purchasePackage(storeProductId: string): Promise<boolean> {
    return this.purchaseProduct(storeProductId);
  }

  /** Restore prior purchases (App Store / Play rule: must be offered). */
  async restorePurchases(): Promise<boolean> {
    if (!this.isNative) return false;
    const Purchases = await this.purchases();
    if (!Purchases) return false;
    const info = await Purchases.restorePurchases();
    const ok =
      Object.keys(info.customerInfo?.entitlements?.active ?? {}).length > 0;
    this.telemetry.track('iap_restored', { entitled: ok });
    return ok;
  }

  private revenueCatKey(): string | undefined {
    const p = runtimePlatform();
    return p === 'ios'
      ? REVENUECAT_IOS_KEY
      : p === 'android'
        ? REVENUECAT_ANDROID_KEY
        : undefined;
  }

  private purchases(): Promise<PurchasesPlugin | null> {
    if (!this.purchasesP) {
      this.purchasesP = this.isNative
        ? import('@revenuecat/purchases-capacitor')
            .then((m) => m.Purchases)
            .catch(() => null)
        : Promise.resolve(null);
    }
    return this.purchasesP;
  }

  private async identifyPurchases(userId: string): Promise<void> {
    const apiKey = this.revenueCatKey();
    if (!apiKey) return;
    try {
      const Purchases = await this.purchases();
      if (!Purchases) return;
      if (!this.rcConfigured) {
        await Purchases.configure({ apiKey, appUserID: userId });
        this.rcConfigured = true;
      } else if (this.rcUserId !== userId) {
        await Purchases.logIn({ appUserID: userId });
      }
      this.rcUserId = userId;
    } catch {
      this.telemetry.track('iap_configure_failed');
    }
  }
}
