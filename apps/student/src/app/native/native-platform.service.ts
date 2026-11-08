import { Injectable, Injector, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationsClient, type DevicePlatform } from '@codify/api-client';
import { I18nService } from '@codify/i18n';
import type { PurchasesPlugin } from '@revenuecat/purchases-capacitor';
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from '../api-base-url.js';
import { isNativeRuntime, runtimePlatform } from '../platform/runtime.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { NativePushService } from './native-push.service.js';
import { NativeShellService } from './native-shell.service.js';

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
 *   - Push: FCM on iOS + Android via `NativePushService` (permission →
 *     FCM token → POST /devices, token refresh, foreground messages,
 *     notification taps deep-link into the app).
 *   - RevenueCat: `configure` with the per-store key from the build define,
 *     `logIn(userId)` after sign-in / `logOut` on sign-out, purchases by the
 *     price's `storeProductId`, restore.
 *   - Android hardware back button (exit at the root) + app foreground state.
 *   - `NativeShellService`: local daily reminder as a backup when remote
 *     push is off, the in-app browser (Stripe portal), theme-aware status
 *     bar and the splash screen (hidden once booted).
 */
@Injectable({ providedIn: 'root' })
export class NativePlatformService {
  private readonly push = inject(NativePushService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly telemetry = inject(TelemetryService);
  readonly shell = inject(NativeShellService);

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
    this.followTheme();
    void this.shell.hideSplash();
    // Tap listeners go on at boot so a cold start from a notification
    // still deep-links (the token is only requested after sign-in).
    void this.push.init();
    try {
      const { App } = await import('@capacitor/app');
      // Ionic is loaded lazily (platform/ionic-root.component.ts) — keep it
      // out of the initial graph that imports this service.
      const { Platform } = await import('@ionic/angular/standalone');
      await App.addListener('appStateChange', ({ isActive }) => {
        this._appActive.set(isActive);
        this.telemetry.track(
          isActive ? 'app_foregrounded' : 'app_backgrounded',
        );
        if (!isActive) void this.telemetry.flush();
      });
      // Lowest priority: Ionic closes overlays / pops the nav stack first;
      // only at the root does the back button leave the app.
      this.injector.get(Platform).backButton.subscribeWithPriority(-1, () => {
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
    await this.syncLocalReminder();
  }

  /**
   * Local daily reminder as a backup for remote push (docs/05 §7): at the
   * learner's reminder time (`reminderMinute`, else `minute`, else 20:00).
   */
  async syncLocalReminder(minute?: number | null): Promise<void> {
    if (!this.isNative) return;
    let at = minute;
    if (at === undefined) {
      try {
        at = (await this.injector.get(NotificationsClient).preferences())
          .reminderMinute;
      } catch {
        at = null;
      }
    }
    const i18n = this.injector.get(I18nService);
    await this.shell.syncDailyReminder(at, {
      title: i18n.t('student.native.reminderTitle'),
      body: i18n.t('student.native.reminderBody'),
    });
  }

  /**
   * Status bar follows the app theme: ThemeService (ui-ionic) toggles
   * `theme-dark` / `theme-light` on <html>; neither = system mode
   * (prefers-color-scheme). Observed here so this service never imports
   * ui-ionic (Ionic stays out of the initial graph).
   */
  private followTheme(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    let last: boolean | null = null;
    const apply = () => {
      const dark =
        root.classList.contains('theme-dark') ||
        (!root.classList.contains('theme-light') && !!media?.matches);
      if (dark === last) return;
      last = dark;
      void this.shell.applyTheme(dark);
    };
    apply();
    media?.addEventListener?.('change', apply);
    if (typeof MutationObserver !== 'undefined')
      new MutationObserver(apply).observe(root, {
        attributes: true,
        attributeFilter: ['class'],
      });
  }

  /** On sign-out: unbind the push token and reset the RevenueCat customer. */
  async onSignedOut(): Promise<void> {
    if (!this.isNative) return;
    await this.push.unregister();
    await this.shell.cancelDailyReminder();
    if (this.rcConfigured && this.rcUserId) {
      const Purchases = await this.purchases();
      await Purchases?.logOut().catch(() => undefined);
      this.rcUserId = null;
    }
  }

  // ─── Push ───────────────────────────────────────────────────────────────

  /**
   * Request push permission, fetch the FCM token and POST it to /devices
   * (see NativePushService). No-op on web.
   */
  async registerForPush(): Promise<void> {
    if (!this.isNative) return;
    await this.push.register();
  }

  /** POST /devices; on 409 `device.rebind_required` register once more. */
  bindToken(token: string): Promise<boolean> {
    return this.push.bindToken(token);
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
