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

interface Pending {
  state: Exclude<OverlayState, null>;
  resolve: () => void;
}

/**
 * Mediates between `RewardOrchestrator` (which decides *when* a level-up
 * or badge overlay should show) and the LevelUpModal / BadgeUnlockOverlay
 * components (which render it).
 *
 * The student app mounts a single overlay host inside the AppShell that
 * subscribes to `current()` and renders the matching overlay. Overlays are
 * queued: a second `show*()` waits until the first is dismissed, and each
 * returned promise resolves when *its* overlay is dismissed.
 */
@Injectable({ providedIn: 'root' })
export class OverlayHostService {
  private readonly currentSig = signal<OverlayState>(null);
  readonly current = this.currentSig.asReadonly();

  private active: Pending | null = null;
  private readonly waiting: Pending[] = [];

  /** Number of overlays waiting behind the current one. */
  get queued(): number {
    return this.waiting.length;
  }

  showLevelUp(info: LevelUpInfo): Promise<void> {
    return this.show({ kind: 'level-up', info });
  }

  showBadgeUnlock(badge: BadgeRef): Promise<void> {
    return this.show({ kind: 'badge-unlock', badge });
  }

  /** Called by the host component when the user dismisses the overlay. */
  dismiss(): void {
    const done = this.active;
    this.active = null;
    this.currentSig.set(null);
    done?.resolve();
    this.next();
  }

  /** Dismiss everything (e.g. on sign-out / route teardown). */
  clear(): void {
    const all = [
      ...this.waiting.splice(0),
      ...(this.active ? [this.active] : []),
    ];
    this.active = null;
    this.currentSig.set(null);
    for (const p of all) p.resolve();
  }

  private show(state: Exclude<OverlayState, null>): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push({ state, resolve });
      if (!this.active) this.next();
    });
  }

  private next(): void {
    const p = this.waiting.shift();
    if (!p) return;
    this.active = p;
    this.currentSig.set(p.state);
  }
}
