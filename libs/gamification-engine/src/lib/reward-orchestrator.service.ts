import { Injectable, inject } from '@angular/core';
import { CoinService } from './state/coin.service.js';
import { XpService } from './state/xp.service.js';
import { StreakService } from './state/streak.service.js';
import { MotionAndSoundService } from './motion-and-sound.service.js';
import { SoundService } from './sound.service.js';
import { HapticsService } from './haptics.service.js';
import { OverlayHostService } from './overlay/overlay-host.service.js';
import { coinFly } from './animation/coin-fly.directive.js';
import { confettiBurst } from './animation/confetti.js';
import type { HapticIntensity, RewardKind, RewardPayload, RewardServerState } from './types.js';

const HAPTIC_FOR: Record<RewardKind, HapticIntensity> = {
  lessonComplete: 'medium',
  quizPass: 'medium',
  exercisePass: 'medium',
  aiPromptComplete: 'light',
  scenarioComplete: 'medium',
  dailyQuestComplete: 'medium',
  streakMilestone: 'heavy',
  levelUp: 'heavy',
  badgeUnlock: 'heavy',
  leaguePromotion: 'heavy',
  mysteryChestOpen: 'heavy',
};

const QUEUE_COLLAPSE_MS = 800;
const COUNTER_TWEEN_MS = 600;

interface QueuedItem {
  payload: RewardPayload;
  enqueuedAt: number;
  resolve: () => void;
}

/**
 * The single client-side entry point for every reward animation. Other
 * code MUST NOT poke `XpService.set()`, `CoinService.set()`, or any
 * animation primitive directly — it must call `grant(payload)` here.
 *
 * Timeline (per docs/07-gamification §11):
 *   T+0    haptic
 *   T+50ms coin trail (sourceEl → coin counter)
 *   T+200ms xp sparkles (sourceEl → xp bar) — folded into counter tween for v1
 *   T+400ms counter increments tween (canonical totals)
 *   T+600ms reward toast slide-in (caller renders the toast; we just emit)
 *   T+1100ms level-up overlay (if any)
 *   T+1100ms (or after level-up) badge overlay (if any)
 *
 * RewardQueue: events within `QUEUE_COLLAPSE_MS` of each other collapse
 * into a single celebration cluster. The orchestrator picks the strongest
 * haptic + sound and runs the visuals once with summed canonical totals.
 *
 * `prefers-reduced-motion`: skip coin-fly + confetti; still tween counters
 * (faster) and still show overlays (no entrance animation).
 */
@Injectable({ providedIn: 'root' })
export class RewardOrchestrator {
  private readonly xp = inject(XpService);
  private readonly coins = inject(CoinService);
  private readonly streaks = inject(StreakService);
  private readonly motion = inject(MotionAndSoundService);
  private readonly sound = inject(SoundService);
  private readonly haptics = inject(HapticsService);
  private readonly overlays = inject(OverlayHostService);

  private queue: QueuedItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRun: Promise<void> = Promise.resolve();

  /**
   * Reconcile the canonical server state immediately, without animation.
   * Used on app boot or after a sync-from-server. RewardOrchestrator owns
   * this call so all state-mutation paths funnel through one place.
   */
  reconcile(state: RewardServerState): void {
    if (typeof state.totalXp === 'number') this.xp.setActual(state.totalXp);
    if (typeof state.coins === 'number') this.coins.setActual(state.coins);
    this.streaks.set({
      currentDays: state.streakDays,
      freezes: state.freezesAvailable,
    });
  }

  /**
   * Plays the reward animation sequence. Resolves once the visuals are
   * complete (counters tweened, overlays dismissed). Multiple grants
   * within `QUEUE_COLLAPSE_MS` collapse into one cluster.
   */
  grant(payload: RewardPayload): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ payload, enqueuedAt: Date.now(), resolve });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), QUEUE_COLLAPSE_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;
    this.currentRun = this.currentRun.then(() => this.run(batch));
  }

  private async run(batch: QueuedItem[]): Promise<void> {
    const collapsed = collapse(batch.map((b) => b.payload));

    // 1. Haptic — strongest from batch.
    const intensity = pickIntensity(collapsed.kinds);
    await this.haptics.impact(intensity).catch(() => undefined);

    const reduced = this.motion.reducedMotion();

    // 2. Coin fly — only if we have a sourceEl AND coins > 0 AND motion allowed.
    if (!reduced && collapsed.sourceEl && collapsed.canonical.coins > 0) {
      void coinFly(collapsed.sourceEl, Math.min(8, Math.max(3, Math.floor(collapsed.canonical.coins / 5))));
      await delay(50);
    }

    // 3. Counter tweens (XP + coins) to the canonical totals.
    const targetXp = this.xp.actual() + collapsed.canonical.xp;
    const targetCoins = this.coins.actual() + collapsed.canonical.coins;
    this.xp.setActual(targetXp);
    this.coins.setActual(targetCoins);

    const tweenMs = reduced ? 200 : COUNTER_TWEEN_MS;
    await Promise.all([
      this.xp.tweenTo(targetXp, tweenMs),
      this.coins.tweenTo(targetCoins, tweenMs),
    ]);

    // 4. Sound — single SFX for the cluster.
    void this.sound.play(strongestKind(collapsed.kinds));

    // 5. Level-up overlay (if any).
    const levelUp = collapsed.levelUp;
    if (levelUp) {
      if (!reduced) {
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 200;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 3 : 200;
        void confettiBurst({ x: cx, y: cy });
      }
      await this.overlays.showLevelUp(levelUp);
    }

    // 6. Badge overlays (sequential).
    for (const badge of collapsed.badgesUnlocked) {
      if (!reduced) {
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 200;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 3 : 200;
        void confettiBurst({ x: cx, y: cy, count: 40 });
      }
      await this.overlays.showBadgeUnlock(badge);
    }

    // 7. Resolve every promise in the batch.
    for (const item of batch) item.resolve();
  }
}

interface CollapsedPayload {
  kinds: RewardKind[];
  canonical: { xp: number; coins: number };
  levelUp: import('./types.js').LevelUpInfo | null;
  badgesUnlocked: import('./types.js').BadgeRef[];
  sourceEl: HTMLElement | null;
}

function collapse(payloads: RewardPayload[]): CollapsedPayload {
  const out: CollapsedPayload = {
    kinds: [],
    canonical: { xp: 0, coins: 0 },
    levelUp: null,
    badgesUnlocked: [],
    sourceEl: null,
  };
  for (const p of payloads) {
    out.kinds.push(p.kind);
    out.canonical.xp += p.canonical.xp;
    out.canonical.coins += p.canonical.coins;
    if (p.levelUp) out.levelUp = p.levelUp; // keep the latest
    if (p.badgesUnlocked) out.badgesUnlocked.push(...p.badgesUnlocked);
    if (!out.sourceEl && p.sourceEl) out.sourceEl = p.sourceEl;
  }
  return out;
}

function pickIntensity(kinds: RewardKind[]): HapticIntensity {
  let best: HapticIntensity = 'light';
  const order: Record<HapticIntensity, number> = { light: 0, medium: 1, heavy: 2 };
  for (const k of kinds) {
    const intensity = HAPTIC_FOR[k];
    if (order[intensity] > order[best]) best = intensity;
  }
  return best;
}

function strongestKind(kinds: RewardKind[]): RewardKind {
  // Prefer level-up > badge > streak > everything else.
  const priority: RewardKind[] = ['levelUp', 'badgeUnlock', 'streakMilestone', 'leaguePromotion'];
  for (const p of priority) if (kinds.includes(p)) return p;
  return kinds[kinds.length - 1] ?? 'lessonComplete';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
