import { Injectable, inject } from '@angular/core';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import type { BrowserPlugin } from '@capacitor/browser';
import type { StatusBarPlugin } from '@capacitor/status-bar';
import type { SplashScreenPlugin } from '@capacitor/splash-screen';
import { isNativeRuntime, runtimePlatform } from '../platform/runtime.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { NativePushService } from './native-push.service.js';

/** Id of the local daily-reminder notification (stable → replaceable). */
export const LOCAL_REMINDER_ID = 7001;
/** Default reminder time (docs/05 Onboarding "Schedule": 8 PM local). */
export const DEFAULT_REMINDER_MINUTE = 20 * 60;

/** Status-bar colours per theme (match `--cdf-color-bg`). */
const BAR_COLORS = { light: '#ffffff', dark: '#0f172a' } as const;

export interface ReminderCopy {
  title: string;
  body: string;
}

/** Plugin loaders — overridable in tests (`setNativeShellPlugins`). */
export interface NativeShellPlugins {
  localNotifications: () => Promise<LocalNotificationsPlugin | null>;
  browser: () => Promise<BrowserPlugin | null>;
  statusBar: () => Promise<{
    StatusBar: StatusBarPlugin;
    Style: { Dark: string; Light: string };
  } | null>;
  splashScreen: () => Promise<SplashScreenPlugin | null>;
}

const DEFAULT_PLUGINS: NativeShellPlugins = {
  localNotifications: () =>
    import('@capacitor/local-notifications')
      .then((m) => m.LocalNotifications)
      .catch(() => null),
  browser: () =>
    import('@capacitor/browser').then((m) => m.Browser).catch(() => null),
  statusBar: () =>
    import('@capacitor/status-bar')
      .then((m) => ({
        StatusBar: m.StatusBar,
        Style: m.Style as unknown as { Dark: string; Light: string },
      }))
      .catch(() => null),
  splashScreen: () =>
    import('@capacitor/splash-screen')
      .then((m) => m.SplashScreen)
      .catch(() => null),
};

let plugins: NativeShellPlugins = DEFAULT_PLUGINS;

/** Test hook: swap the plugin loaders (pass null to restore). */
export function setNativeShellPlugins(p: Partial<NativeShellPlugins> | null) {
  plugins = p ? { ...DEFAULT_PLUGINS, ...p } : DEFAULT_PLUGINS;
}

/**
 * The rest of the Capacitor surface (docs/05 §7), all behind native
 * checks with web fallbacks:
 *
 *   - Local Notifications: a backup daily reminder when remote push is off
 *     (permission denied / unavailable) — scheduled at the learner's
 *     reminder time, cancelled once remote push works again. Web: no-op.
 *   - Browser: external pages (Stripe Customer Portal) in the in-app
 *     browser on native; a new tab on the web (same-tab if blocked).
 *   - StatusBar / SplashScreen: status-bar style + colour follow the app
 *     theme; the splash hides once the app has booted. Web: no-op.
 */
@Injectable({ providedIn: 'root' })
export class NativeShellService {
  private readonly push = inject(NativePushService);
  private readonly telemetry = inject(TelemetryService);

  get isNative(): boolean {
    return isNativeRuntime();
  }

  // ─── Local reminder backup ───────────────────────────────────────────

  /**
   * Keep the local daily reminder in line with the remote-push state:
   * scheduled (repeating daily at `minute`, user-local) when remote push
   * is not granted, cancelled otherwise. Returns what it did.
   */
  async syncDailyReminder(
    minute: number | null | undefined,
    copy: ReminderCopy,
  ): Promise<'scheduled' | 'cancelled' | 'skipped'> {
    if (!this.isNative) return 'skipped';
    const ln = await plugins.localNotifications();
    if (!ln) return 'skipped';
    try {
      const remote = await this.push.permission();
      await ln.cancel({ notifications: [{ id: LOCAL_REMINDER_ID }] });
      if (remote === 'granted') return 'cancelled';
      let perm = await ln.checkPermissions();
      if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale')
        perm = await ln.requestPermissions();
      if (perm.display !== 'granted') return 'skipped';
      const at = clampMinute(minute ?? DEFAULT_REMINDER_MINUTE);
      await ln.schedule({
        notifications: [
          {
            id: LOCAL_REMINDER_ID,
            title: copy.title,
            body: copy.body,
            schedule: {
              on: { hour: Math.floor(at / 60), minute: at % 60 },
              repeats: true,
              allowWhileIdle: true,
            },
            extra: { deepLink: '/today', type: 'local_reminder' },
          },
        ],
      });
      this.telemetry.track('local_reminder_scheduled', { minute: at });
      return 'scheduled';
    } catch {
      return 'skipped';
    }
  }

  /** Cancel the local reminder (sign-out). */
  async cancelDailyReminder(): Promise<void> {
    if (!this.isNative) return;
    const ln = await plugins.localNotifications();
    await ln
      ?.cancel({ notifications: [{ id: LOCAL_REMINDER_ID }] })
      .catch(() => undefined);
  }

  // ─── Browser ─────────────────────────────────────────────────────────

  /**
   * Open an external page: the in-app browser on native (Stripe Customer
   * Portal, docs/09 §7), a new tab on the web. A blocked popup falls back
   * to navigating this tab.
   */
  async openExternal(url: string): Promise<void> {
    if (this.isNative) {
      const browser = await plugins.browser();
      if (browser) {
        await browser.open({ url, presentationStyle: 'popover' });
        return;
      }
    }
    // No 'noopener' feature: with it window.open always returns null, which
    // would look like a blocked popup. Drop the opener by hand instead.
    const win = globalThis.open?.(url, '_blank');
    if (win) win.opener = null;
    else globalThis.location.assign(url);
  }

  // ─── StatusBar / SplashScreen ────────────────────────────────────────

  /** Status bar matches the theme (dark content on light, and vice versa). */
  async applyTheme(dark: boolean): Promise<void> {
    if (!this.isNative) return;
    const sb = await plugins.statusBar();
    if (!sb) return;
    try {
      await sb.StatusBar.setStyle({
        style: (dark ? sb.Style.Dark : sb.Style.Light) as never,
      });
      if (runtimePlatform() === 'android')
        await sb.StatusBar.setBackgroundColor({
          color: dark ? BAR_COLORS.dark : BAR_COLORS.light,
        });
    } catch {
      /* status bar not available in this shell */
    }
  }

  async hideSplash(): Promise<void> {
    if (!this.isNative) return;
    const splash = await plugins.splashScreen();
    await splash?.hide({ fadeOutDuration: 200 }).catch(() => undefined);
  }
}

function clampMinute(m: number): number {
  if (!Number.isFinite(m)) return DEFAULT_REMINDER_MINUTE;
  return Math.min(1439, Math.max(0, Math.round(m)));
}
