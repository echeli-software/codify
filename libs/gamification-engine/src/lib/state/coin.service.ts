import { Injectable, signal } from '@angular/core';

/**
 * Mirrors the user's canonical coin balance. Same actual/displayed split
 * as `XpService` so animations can roll up the counter smoothly while
 * the actual server-canonical total is preserved.
 */
@Injectable({ providedIn: 'root' })
export class CoinService {
  private readonly actualSig = signal(0);
  private readonly displayedSig = signal(0);

  readonly actual = this.actualSig.asReadonly();
  readonly displayed = this.displayedSig.asReadonly();

  setActual(coins: number): void {
    const v = Math.max(0, Math.floor(coins));
    this.actualSig.set(v);
    if (this.displayedSig() === 0) this.displayedSig.set(v);
  }

  snap(coins?: number): void {
    const v = coins ?? this.actualSig();
    this.displayedSig.set(Math.max(0, Math.floor(v)));
  }

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
