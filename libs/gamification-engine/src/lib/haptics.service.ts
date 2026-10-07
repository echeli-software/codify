import { Injectable, InjectionToken, inject } from '@angular/core';
import type { HapticIntensity } from './types.js';

/**
 * Pluggable haptics backend. The student app's native shell may provide
 * one backed by `@capacitor/haptics`; when absent we look for the plugin
 * the Capacitor runtime registers on `window.Capacitor.Plugins.Haptics`
 * (no module import, no `eval`/`new Function` — CSP-safe) and finally fall
 * back to `navigator.vibrate`.
 */
export interface HapticsAdapter {
  impact(intensity: HapticIntensity): Promise<void> | void;
}

export const HAPTICS_ADAPTER = new InjectionToken<HapticsAdapter>(
  'HAPTICS_ADAPTER',
);

interface CapacitorHapticsPlugin {
  impact(opts: { style: string }): Promise<void>;
}

const STYLE: Record<HapticIntensity, string> = {
  light: 'LIGHT',
  medium: 'MEDIUM',
  heavy: 'HEAVY',
};

const VIBRATE_MS: Record<HapticIntensity, number> = {
  light: 10,
  medium: 20,
  heavy: 30,
};

/**
 * Thin haptics wrapper: Capacitor on device, `navigator.vibrate` on
 * Android Chrome, silent elsewhere. Never throws.
 */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  private readonly adapter = inject(HAPTICS_ADAPTER, { optional: true });

  async impact(intensity: HapticIntensity): Promise<void> {
    try {
      if (this.adapter) {
        await this.adapter.impact(intensity);
        return;
      }
      const plugin = capacitorHaptics();
      if (plugin) {
        await plugin.impact({ style: STYLE[intensity] });
        return;
      }
    } catch {
      /* fall through to web vibrate */
    }
    webVibrate(intensity);
  }
}

function capacitorHaptics(): CapacitorHapticsPlugin | null {
  const cap = (
    globalThis as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        Plugins?: { Haptics?: CapacitorHapticsPlugin };
      };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const plugin = cap.Plugins?.Haptics;
  return typeof plugin?.impact === 'function' ? plugin : null;
}

function webVibrate(intensity: HapticIntensity): void {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.vibrate !== 'function'
  )
    return;
  try {
    navigator.vibrate(VIBRATE_MS[intensity]);
  } catch {
    /* permission denied — ignore */
  }
}
