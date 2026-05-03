import { Injectable } from '@angular/core';
import type { HapticIntensity } from './types.js';

/**
 * Thin wrapper around `Capacitor/Haptics` that no-ops on web (or when
 * the plugin isn't bundled). Imported lazily so the web bundle stays
 * lean and so a missing plugin never breaks orchestration.
 *
 * Web-vibration fallback: when `navigator.vibrate` is available (Android
 * Chrome), we use it with intensity-mapped durations. iOS Safari has no
 * web-vibrate, so it stays silent — Capacitor takes over inside the
 * native shell.
 */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  private capacitorImpactPromise: Promise<((style: string) => Promise<void>) | null> | null = null;

  async impact(intensity: HapticIntensity): Promise<void> {
    const capacitorImpact = await this.getCapacitorImpact();
    if (capacitorImpact) {
      const style = intensity === 'light' ? 'Light' : intensity === 'heavy' ? 'Heavy' : 'Medium';
      try {
        await capacitorImpact(style);
        return;
      } catch {
        /* fall through to web vibrate */
      }
    }
    this.webVibrate(intensity);
  }

  private webVibrate(intensity: HapticIntensity): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const ms = intensity === 'light' ? 10 : intensity === 'heavy' ? 30 : 20;
    try {
      navigator.vibrate(ms);
    } catch {
      /* permission denied — ignore */
    }
  }

  private getCapacitorImpact(): Promise<((style: string) => Promise<void>) | null> {
    if (this.capacitorImpactPromise) return this.capacitorImpactPromise;
    this.capacitorImpactPromise = (async () => {
      try {
        // Plugin is optional — when bundled into the Capacitor shell this
        // resolves to the real implementation; on web (or before install)
        // it's missing, so we wrap in `Function` to keep TS quiet and let
        // bundlers skip the unresolved specifier.
        const dynamicImport = new Function('s', 'return import(s)') as (
          s: string,
        ) => Promise<unknown>;
        const mod = (await dynamicImport('@capacitor/haptics').catch(() => null)) as
          | { Haptics?: { impact: (opts: { style: string }) => Promise<void> } }
          | null;
        if (!mod) return null;
        const haptics = mod.Haptics;
        if (!haptics?.impact) return null;
        return (style: string) => haptics.impact({ style });
      } catch {
        return null;
      }
    })();
    return this.capacitorImpactPromise;
  }
}
