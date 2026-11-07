import { Injectable, signal } from '@angular/core';
import { clampCount, tweenSignal } from './tween.js';

/**
 * Mirrors the user's canonical coin balance. Same actual/displayed split
 * as `XpService` so animations can roll up the counter smoothly while
 * the actual server-canonical total is preserved. Mutations are reserved
 * for `RewardOrchestrator` (lint-enforced).
 */
@Injectable({ providedIn: 'root' })
export class CoinService {
  private readonly actualSig = signal(0);
  private readonly displayedSig = signal(0);
  private readonly tweenToken = { current: 0 };

  readonly actual = this.actualSig.asReadonly();
  readonly displayed = this.displayedSig.asReadonly();

  /** Replace the canonical total; `displayed` is left to snap/tween. */
  setActual(coins: number): void {
    this.actualSig.set(clampCount(coins));
  }

  /** Snap the displayed value (no animation); cancels a running tween. */
  snap(coins?: number): void {
    this.tweenToken.current++;
    this.displayedSig.set(clampCount(coins ?? this.actualSig()));
  }

  tweenTo(target: number, durationMs = 600): Promise<void> {
    return tweenSignal(
      this.displayedSig,
      clampCount(target),
      durationMs,
      this.tweenToken,
    );
  }
}
