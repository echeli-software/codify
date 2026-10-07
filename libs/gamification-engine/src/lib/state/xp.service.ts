import { Injectable, signal, computed } from '@angular/core';
import { levelFromXp, levelProgressPct, xpToNextLevel } from '@codify/ui-core';
import { clampCount, tweenSignal } from './tween.js';

/**
 * Mirrors the user's canonical XP / level state on the client. Updates
 * come via `RewardOrchestrator` after the server returns the canonical
 * totals — we never let the UI invent XP locally (per docs/07-gamification
 * §11 anti-abuse). Only `RewardOrchestrator` may call the mutating methods
 * (`setActual` / `snap` / `tweenTo`) — enforced by the
 * `codify/rewards-through-orchestrator` lint rule.
 *
 * Holds both an `actual` value (the latest canonical total) and a
 * `displayed` value the orchestrator animates up to it. Components bind to
 * `displayed` so the counter rolls up smoothly.
 */
@Injectable({ providedIn: 'root' })
export class XpService {
  private readonly actualSig = signal(0);
  private readonly displayedSig = signal(0);
  private readonly tweenToken = { current: 0 };

  readonly actual = this.actualSig.asReadonly();
  readonly displayed = this.displayedSig.asReadonly();

  readonly level = computed(() => levelFromXp(this.displayed()));
  readonly progressPct = computed(() => levelProgressPct(this.displayed()));
  readonly toNextLevel = computed(() => xpToNextLevel(this.displayed()));

  /**
   * Replace the canonical total. Does NOT touch `displayed` — callers
   * either `tweenTo()` (reward) or `snap()` (reconcile) afterwards.
   */
  setActual(xp: number): void {
    this.actualSig.set(clampCount(xp));
  }

  /** Snap the displayed value (no animation); cancels a running tween. */
  snap(xp?: number): void {
    this.tweenToken.current++;
    this.displayedSig.set(clampCount(xp ?? this.actualSig()));
  }

  /**
   * Tween `displayed` from its current value to `target` over `durationMs`.
   * Returns a promise that resolves when the tween completes.
   */
  tweenTo(target: number, durationMs = 600): Promise<void> {
    return tweenSignal(
      this.displayedSig,
      clampCount(target),
      durationMs,
      this.tweenToken,
    );
  }
}
