import { Injectable, signal, computed } from '@angular/core';
import { levelFromXp, levelProgressPct, xpToNextLevel } from '@codify/ui-core';

/**
 * Mirrors the user's canonical XP / level state on the client. Updates
 * come via `RewardOrchestrator` after the server returns the canonical
 * totals — we never let the UI invent XP locally (per docs/07-gamification
 * §11 anti-abuse).
 *
 * For tween-friendly UI, hold both an `actual` value (the latest canonical
 * total) and a `displayed` value the orchestrator may animate up to it.
 * Components bind to `displayed` so the counter rolls up smoothly.
 */
@Injectable({ providedIn: 'root' })
export class XpService {
  private readonly actualSig = signal(0);
  private readonly displayedSig = signal(0);

  readonly actual = this.actualSig.asReadonly();
  readonly displayed = this.displayedSig.asReadonly();

  readonly level = computed(() => levelFromXp(this.displayed()));
  readonly progressPct = computed(() => levelProgressPct(this.displayed()));
  readonly toNextLevel = computed(() => xpToNextLevel(this.displayed()));

  /** Replace the canonical total. UI should call `tweenTo(actual)` separately. */
  setActual(xp: number): void {
    const v = Math.max(0, Math.floor(xp));
    this.actualSig.set(v);
    // If we've never displayed anything, snap on first set.
    if (this.displayedSig() === 0) this.displayedSig.set(v);
  }

  /** Snap the displayed value (no animation). */
  snap(xp?: number): void {
    const v = xp ?? this.actualSig();
    this.displayedSig.set(Math.max(0, Math.floor(v)));
  }

  /**
   * Tween `displayed` from its current value to `target` over `durationMs`.
   * Returns a promise that resolves when the tween completes.
   */
  tweenTo(target: number, durationMs = 600): Promise<void> {
    const start = this.displayedSig();
    const end = Math.max(0, Math.floor(target));
    if (start === end) {
      this.displayedSig.set(end);
      return Promise.resolve();
    }
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
      this.displayedSig.set(end);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / durationMs);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const v = Math.round(start + (end - start) * eased);
        this.displayedSig.set(v);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
}
