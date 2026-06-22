import { Injectable, inject } from '@angular/core';
import { DevicesClient, type DevicePlatform } from '@codify/api-client';

/**
 * Bridge to the Capacitor native shell (Phase 11). Everything degrades to a
 * safe no-op on the web, so the same codebase runs as a PWA and inside the
 * iOS/Android shell. Native plugins are imported lazily through an indirected
 * `import()` (the same trick HapticsService uses) so the web bundle never
 * tries to resolve a plugin that isn't installed for the browser build.
 *
 * The pieces that need real native infra — signed FCM/APNs delivery and the
 * RevenueCat purchase sheet — only run on-device; here they're wired but inert
 * on web. See /docs/11-mobile.md.
 */
@Injectable({ providedIn: 'root' })
export class NativePlatformService {
  private readonly devices = inject(DevicesClient);
  private registeredToken: string | null = null;

  /** True only inside the Capacitor shell. */
  get isNative(): boolean {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  }

  /** 'IOS' | 'ANDROID' | 'WEB' — the device-token platform tag. */
  platform(): DevicePlatform {
    const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    const p = cap?.getPlatform?.() ?? 'web';
    return p === 'ios' ? 'IOS' : p === 'android' ? 'ANDROID' : 'WEB';
  }

  /**
   * Request push permission, register with APNs/FCM, and POST the resulting
   * token to /devices. No-op on web (no Capacitor PushNotifications plugin).
   */
  async registerForPush(): Promise<void> {
    if (!this.isNative) return;
    const mod = (await importOptional('@capacitor/push-notifications')) as PushPlugin | null;
    const Push = mod?.PushNotifications;
    if (!Push) return;
    try {
      const perm = await Push.requestPermissions();
      if (perm.receive !== 'granted') return;
      Push.addListener('registration', (t: { value: string }) => {
        if (t.value && t.value !== this.registeredToken) {
          this.registeredToken = t.value;
          void this.devices.register(t.value, this.platform()).catch(() => undefined);
        }
      });
      await Push.register();
    } catch {
      /* push unavailable — ignore */
    }
  }

  /**
   * Buy a plan through the store (RevenueCat). Returns true if a purchase
   * completed; the entitlement then syncs to our Subscription via the
   * RevenueCat webhook. Throws on web — callers fall back to web checkout.
   */
  async purchasePackage(productId: string): Promise<boolean> {
    if (!this.isNative) throw new Error('IAP is only available in the mobile app');
    const mod = (await importOptional('@revenuecat/purchases-capacitor')) as PurchasesPlugin | null;
    const Purchases = mod?.Purchases;
    if (!Purchases) throw new Error('Store purchases unavailable');
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages?.find((p) => p.product.identifier === productId)
      ?? offerings.current?.availablePackages?.[0];
    if (!pkg) throw new Error('No store package found');
    const res = await Purchases.purchasePackage({ aPackage: pkg });
    return Object.keys(res.customerInfo?.entitlements?.active ?? {}).length > 0;
  }

  /** Restore prior purchases (App Store / Play rule: must be offered). */
  async restorePurchases(): Promise<boolean> {
    if (!this.isNative) return false;
    const mod = (await importOptional('@revenuecat/purchases-capacitor')) as PurchasesPlugin | null;
    const Purchases = mod?.Purchases;
    if (!Purchases) return false;
    const info = await Purchases.restorePurchases();
    return Object.keys(info.customerInfo?.entitlements?.active ?? {}).length > 0;
  }
}

/** Indirected dynamic import so bundlers don't try to resolve native-only specifiers. */
function importOptional(specifier: string): Promise<unknown> {
  const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
  return dynamicImport(specifier).catch(() => null);
}

// Minimal shapes of the native plugins (typed locally; packages are native-only).
interface PushPlugin {
  PushNotifications?: {
    requestPermissions(): Promise<{ receive: string }>;
    register(): Promise<void>;
    addListener(event: string, cb: (data: { value: string }) => void): void;
  };
}
interface PurchasesPlugin {
  Purchases?: {
    getOfferings(): Promise<{ current?: { availablePackages?: RcPackage[] } }>;
    purchasePackage(opts: { aPackage: RcPackage }): Promise<{ customerInfo?: RcCustomerInfo }>;
    restorePurchases(): Promise<{ customerInfo?: RcCustomerInfo }>;
  };
}
interface RcPackage {
  product: { identifier: string };
}
interface RcCustomerInfo {
  entitlements?: { active?: Record<string, unknown> };
}
