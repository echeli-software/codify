import { Injectable, signal } from '@angular/core';
import type { BadgeRef, LevelUpInfo } from '../types.js';

export type OverlayKind = 'level-up' | 'badge-unlock';

export interface LevelUpOverlay {
  kind: 'level-up';
  info: LevelUpInfo;
}

export interface BadgeUnlockOverlay {
  kind: 'badge-unlock';
  badge: BadgeRef;
}

export type OverlayState = LevelUpOverlay | BadgeUnlockOverlay | null;

/**
 * Mediates between `RewardOrchestrator` (which decides *when* a level-up
 * or badge overlay should show) and the LevelUpModal / BadgeUnlockOverlay
 * components (which render it).
 *
 * The student app mounts a single `<cdf-reward-overlays />` host inside
 * the AppShell that subscribes to `current()` and renders the matching
 * overlay. The orchestrator calls `show()` and awaits the returned promise
 * before stepping the timeline forward.
 */
@Injectable({ providedIn: 'root' })
export class OverlayHostService {
  private readonly currentSig = signal<OverlayState>(null);
  readonly current = this.currentSig.asReadonly();

  private resolveCurrent: (() => void) | null = null;

  showLevelUp(info: LevelUpInfo): Promise<void> {
    return this.show({ kind: 'level-up', info });
  }

  showBadgeUnlock(badge: BadgeRef): Promise<void> {
    return this.show({ kind: 'badge-unlock', badge });
  }

  /** Called by the host component when the user dismisses the overlay. */
  dismiss(): void {
    this.currentSig.set(null);
    const resolve = this.resolveCurrent;
    this.resolveCurrent = null;
    resolve?.();
  }

  private show(state: OverlayState): Promise<void> {
    // If a previous overlay was open and never resolved, resolve it before
    // showing the next so the orchestrator timeline continues.
    this.resolveCurrent?.();
    this.currentSig.set(state);
    return new Promise<void>((resolve) => {
      this.resolveCurrent = resolve;
    });
  }
}
