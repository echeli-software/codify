import { Injectable, computed, inject, type Signal } from '@angular/core';
import { NetworkStatusService } from '../offline/network-status.service.js';

/**
 * Surfaces that need the server (docs/16 §3 capability matrix): code
 * exercises (Judge0), AI-prompt grading, coin spends, social actions,
 * payments and live leaderboards are disabled offline — never queued.
 */
export type Capability =
  | 'exercise'
  | 'aiPrompt'
  | 'shop'
  | 'social'
  | 'payments'
  | 'leaderboard';

export const CAPABILITIES: readonly Capability[] = [
  'exercise',
  'aiPrompt',
  'shop',
  'social',
  'payments',
  'leaderboard',
];

/**
 * Capability gating for online-only surfaces. Pages either read
 * `available(cap)()` to disable a button (with `reasonKey(cap)` as the
 * tooltip/explanation) or wrap a whole section in
 * `<cdf-offline-gate capability="shop">…</cdf-offline-gate>`.
 */
@Injectable({ providedIn: 'root' })
export class CapabilityService {
  private readonly network = inject(NetworkStatusService);
  private readonly cache = new Map<Capability, Signal<boolean>>();

  /** Reactive: false while offline. */
  available(cap: Capability): Signal<boolean> {
    let s = this.cache.get(cap);
    if (!s) {
      s = computed(() => this.network.online());
      this.cache.set(cap, s);
    }
    return s;
  }

  /** Translation key explaining why `cap` is unavailable ("Connect to run code"). */
  reasonKey(cap: Capability): string {
    return `studentPlatform.capability.${cap}.reason`;
  }

  /** Short title key for the unavailable state ("Connect to run code"). */
  titleKey(cap: Capability): string {
    return `studentPlatform.capability.${cap}.title`;
  }
}
