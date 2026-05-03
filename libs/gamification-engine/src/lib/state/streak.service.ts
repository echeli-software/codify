import { Injectable, signal } from '@angular/core';

/**
 * Mirrors the user's streak state. Per docs/07-gamification §6:
 * - `currentDays` = consecutive days with at least one lesson.
 * - `freezesAvailable` = banked passes that auto-cover a missed day.
 * - `bestDays` = longest historical streak.
 *
 * Day rollover happens server-side; this service just reflects the
 * canonical totals after each reward grant.
 */
@Injectable({ providedIn: 'root' })
export class StreakService {
  private readonly currentDaysSig = signal(0);
  private readonly freezesSig = signal(0);
  private readonly bestDaysSig = signal(0);

  readonly currentDays = this.currentDaysSig.asReadonly();
  readonly freezesAvailable = this.freezesSig.asReadonly();
  readonly bestDays = this.bestDaysSig.asReadonly();

  set(state: { currentDays?: number; freezes?: number; bestDays?: number }): void {
    if (typeof state.currentDays === 'number') {
      this.currentDaysSig.set(Math.max(0, Math.floor(state.currentDays)));
    }
    if (typeof state.freezes === 'number') {
      this.freezesSig.set(Math.max(0, Math.floor(state.freezes)));
    }
    if (typeof state.bestDays === 'number') {
      this.bestDaysSig.set(Math.max(0, Math.floor(state.bestDays)));
    }
  }
}
