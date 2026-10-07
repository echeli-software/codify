import { Injectable, inject, signal } from '@angular/core';
import { CoinService } from './state/coin.service.js';
import { XpService } from './state/xp.service.js';
import { StreakService } from './state/streak.service.js';
import { MotionAndSoundService } from './motion-and-sound.service.js';
import { SoundService } from './sound.service.js';
import { HapticsService } from './haptics.service.js';
import { OverlayHostService } from './overlay/overlay-host.service.js';
import { coinFly } from './animation/coin-fly.directive.js';
import { confettiBurst } from './animation/confetti.js';
import type {
  BadgeRef,
  HapticIntensity,
  LevelUpInfo,
  RewardBreakdownEntry,
  RewardGrantResult,
  RewardKind,
  RewardMultiplierPart,
  RewardPayload,
  RewardServerState,
  RewardToastEvent,
} from './types.js';

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

/** Rewards arriving within this window of the FIRST queued one collapse. */
export const REWARD_COLLAPSE_WINDOW_MS = 800;
/** Counter tween length (docs/07 §11 T+400ms → ~T+1000ms). */
export const COUNTER_TWEEN_MS = 600;
/** Reduced motion: "counters increment by simple ease in 200ms". */
export const REDUCED_TWEEN_MS = 200;

const MULTIPLIER_LABELS: Record<string, { label: string; key: string }> = {
  PREMIUM_DEFAULT: { label: 'premium', key: 'gamification.multiplier.premium' },
  STREAK_TIER: { label: 'streak', key: 'gamification.multiplier.streakTier' },
  COURSE_PROMO: {
    label: 'course promo',
    key: 'gamification.multiplier.coursePromo',
  },
  LESSON_PROMO: {
    label: 'lesson promo',
    key: 'gamification.multiplier.lessonPromo',
  },
  CAMPAIGN: { label: 'event', key: 'gamification.multiplier.campaign' },
};

interface QueuedItem {
  payload: RewardPayload;
  resolve: (result: RewardGrantResult) => void;
}

/**
 * The single client-side entry point for every reward animation. Other
 * code MUST NOT poke `XpService` / `CoinService` / `StreakService` mutators
 * or animation primitives directly — it calls `grant(payload)` here
 * (enforced by the `codify/rewards-through-orchestrator` lint rule).
 *
 * Timeline (per docs/07-gamification §11):
 *   T+0     haptic (strongest of the cluster)
 *   T+0     coin trail (sourceEl → coin counter) + one SFX
 *   T+50ms  counters tween to the server's canonical totals
 *   then    reward toast event (`toast` signal) — caller renders it
 *   then    level-up overlay, then badge overlays (queued; not awaited by
 *           `grant()` — use `result.overlays` to wait for dismissal)
 *
 * RewardQueue: the collapse window opens at the FIRST queued event and
 * closes `REWARD_COLLAPSE_WINDOW_MS` later (not a trailing debounce, so a
 * steady stream can't postpone celebrations forever). Everything queued in
 * that window plays as one cluster.
 *
 * `prefers-reduced-motion` (or the user's motion toggle): no coin-fly, no
 * confetti, no overlays — counters ease in 200ms and the toast carries the
 * level-up / badge lines instead (`replacesOverlays: true`).
 *
 * Deterministic replays: `useSeed(n)` makes coin-fly + confetti particle
 * plans reproducible (ui-core `mulberry32`).
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
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private runChain: Promise<void> = Promise.resolve();
  private overlayChain: Promise<void> = Promise.resolve();
  private seed: number | null = null;
  private runIndex = 0;
  private toastSeq = 0;

  private readonly toastSig = signal<RewardToastEvent | null>(null);
  /** Latest reward toast (one per orchestration run). */
  readonly toast = this.toastSig.asReadonly();

  /** Make particle animations reproducible; `null` restores `Math.random`. */
  useSeed(seed: number | null): void {
    this.seed = seed;
    this.runIndex = 0;
  }

  /**
   * Reconcile the canonical server state immediately, without animation.
   * Used on app boot or after a sync-from-server: both `actual` and
   * `displayed` jump to the server values (cancelling any running tween).
   */
  reconcile(state: RewardServerState): void {
    if (typeof state.totalXp === 'number') {
      this.xp.setActual(state.totalXp);
      this.xp.snap();
    }
    if (typeof state.coins === 'number') {
      this.coins.setActual(state.coins);
      this.coins.snap();
    }
    this.applyStreak(state);
  }

  /**
   * Queue a reward celebration. Resolves once the counters reached the
   * canonical totals and the toast was emitted — NOT after overlays are
   * dismissed (await `result.overlays` for that). Never rejects.
   */
  grant(payload: RewardPayload): Promise<RewardGrantResult> {
    return new Promise<RewardGrantResult>((resolve) => {
      this.queue.push({ payload, resolve });
      if (!this.windowTimer) {
        this.windowTimer = setTimeout(
          () => this.flush(),
          REWARD_COLLAPSE_WINDOW_MS,
        );
      }
    });
  }

  /** Close the collapse window now (e.g. before navigating away). */
  flushNow(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.flush();
  }

  private flush(): void {
    this.windowTimer = null;
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;
    this.runChain = this.runChain.then(() => this.run(batch));
  }

  private async run(batch: QueuedItem[]): Promise<void> {
    const c = collapse(batch.map((b) => b.payload));
    const reduced = this.motion.reducedMotion();
    const seed = this.seed === null ? null : this.seed + this.runIndex++ * 7919;

    // Canonical targets: server totals win; deltas are only a fallback for
    // payloads that predate `totals`.
    const targetXp = c.totals?.totalXp ?? this.xp.actual() + c.xp;
    const targetCoins = c.totals?.coins ?? this.coins.actual() + c.coins;
    const toast = this.buildToast(c, reduced);
    let overlays: Promise<void> = Promise.resolve();

    try {
      void this.haptics.impact(pickIntensity(c.kinds)).catch(() => undefined);
      void this.sound.play(strongestKind(c.kinds)).catch(() => undefined);

      if (!reduced && c.sourceEl && targetCoins > this.coins.displayed()) {
        const n = Math.min(7, Math.max(3, Math.floor(c.coins / 5)));
        void coinFly(c.sourceEl, n, { seed }).catch(() => undefined);
        await delay(50);
      }

      this.xp.setActual(targetXp);
      this.coins.setActual(targetCoins);
      if (c.totals) this.applyStreak(c.totals);

      const ms = reduced ? REDUCED_TWEEN_MS : COUNTER_TWEEN_MS;
      await Promise.all([
        this.xp.tweenTo(targetXp, ms),
        this.coins.tweenTo(targetCoins, ms),
      ]);

      this.toastSig.set(toast);
      if (!reduced && (c.levelUp || c.badges.length > 0)) {
        overlays = this.queueOverlays(c.levelUp, c.badges, seed);
      }
    } catch (err) {
      // A failing animation must never wedge the queue or leave the
      // counters off the canonical totals.
      this.xp.setActual(targetXp);
      this.xp.snap();
      this.coins.setActual(targetCoins);
      this.coins.snap();
      this.toastSig.set(toast);
      if (typeof console !== 'undefined')
        console.warn('[RewardOrchestrator] run failed', err);
    }

    const result: RewardGrantResult = {
      totals: { totalXp: targetXp, coins: targetCoins },
      toast,
      overlays,
    };
    for (const item of batch) item.resolve(result);
  }

  private queueOverlays(
    levelUp: LevelUpInfo | null,
    badges: BadgeRef[],
    seed: number | null,
  ): Promise<void> {
    const play = async () => {
      const burst = (count: number, offset: number) => {
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 200;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 3 : 200;
        void confettiBurst({
          x: cx,
          y: cy,
          count,
          seed: seed === null ? null : seed + offset,
        }).catch(() => undefined);
      };
      if (levelUp) {
        burst(60, 1);
        await this.overlays.showLevelUp(levelUp);
      }
      let i = 2;
      for (const badge of badges) {
        burst(40, i++);
        await this.overlays.showBadgeUnlock(badge);
      }
    };
    this.overlayChain = this.overlayChain.then(play).catch(() => undefined);
    return this.overlayChain;
  }

  private applyStreak(state: RewardServerState): void {
    this.streaks.set({
      currentDays: state.streakDays,
      freezes: state.freezesAvailable,
      bestDays: state.bestDays,
    });
  }

  private buildToast(c: CollapsedPayload, reduced: boolean): RewardToastEvent {
    const parts = multiplierParts(c.breakdown);
    const replacesOverlays =
      reduced && (c.levelUp !== null || c.badges.length > 0);
    const segments: string[] = [];
    if (c.xp > 0) segments.push(`+${c.xp} XP`);
    if (c.coins > 0)
      segments.push(`+${c.coins} ${c.coins === 1 ? 'coin' : 'coins'}`);
    let text = segments.join(' · ');
    const factors = parts.length
      ? parts.map((p) => `${formatFactor(p.value)} ${p.label}`).join(' × ')
      : c.multiplier && c.multiplier > 1
        ? formatFactor(c.multiplier)
        : '';
    if (factors) text += `${text ? ' ' : ''}(×${factors})`;
    if (replacesOverlays) {
      const extra: string[] = [];
      if (c.levelUp) extra.push(`Level ${c.levelUp.newLevel}!`);
      for (const b of c.badges) extra.push(`Badge unlocked: ${b.name}`);
      text = [text, ...extra].filter(Boolean).join(' · ');
    }
    return {
      id: ++this.toastSeq,
      kinds: c.kinds,
      xp: c.xp,
      coins: c.coins,
      multiplier: c.multiplier,
      parts,
      text,
      levelUp: c.levelUp,
      badges: c.badges,
      replacesOverlays,
    };
  }
}

interface CollapsedPayload {
  kinds: RewardKind[];
  xp: number;
  coins: number;
  multiplier: number | null;
  breakdown: RewardBreakdownEntry[];
  totals: RewardServerState | null;
  levelUp: LevelUpInfo | null;
  badges: BadgeRef[];
  sourceEl: HTMLElement | null;
}

/** Fold a window of payloads into one celebration. Exported for tests. */
export function collapse(payloads: RewardPayload[]): CollapsedPayload {
  const out: CollapsedPayload = {
    kinds: [],
    xp: 0,
    coins: 0,
    multiplier: null,
    breakdown: [],
    totals: null,
    levelUp: null,
    badges: [],
    sourceEl: null,
  };
  let totalsAt = -Infinity;
  payloads.forEach((p, index) => {
    out.kinds.push(p.kind);
    out.xp += Math.max(0, p.canonical.xp);
    out.coins += Math.max(0, p.canonical.coins);
    if (typeof p.canonical.multiplier === 'number') {
      out.multiplier = Math.max(out.multiplier ?? 0, p.canonical.multiplier);
    }
    if (p.canonical.breakdown?.length) out.breakdown = p.canonical.breakdown;
    if (p.totals) {
      // Latest server snapshot wins (by server timestamp, else arrival).
      const at = p.serverTimestamp ? Date.parse(p.serverTimestamp) : index;
      const stamp = Number.isNaN(at) ? index : at;
      if (stamp >= totalsAt) {
        out.totals = { ...(out.totals ?? {}), ...p.totals };
        totalsAt = stamp;
      } else {
        out.totals = { ...p.totals, ...out.totals };
      }
    }
    if (
      p.levelUp &&
      (!out.levelUp || p.levelUp.newLevel > out.levelUp.newLevel)
    ) {
      out.levelUp = p.levelUp;
    }
    for (const b of p.badgesUnlocked ?? []) {
      if (!out.badges.some((x) => x.id === b.id)) out.badges.push(b);
    }
    if (!out.sourceEl && p.sourceEl) out.sourceEl = p.sourceEl;
  });
  return out;
}

/** Multiplier factors (> 1) from a breakdown, labelled for the toast. */
export function multiplierParts(
  breakdown: readonly RewardBreakdownEntry[],
): RewardMultiplierPart[] {
  const parts: RewardMultiplierPart[] = [];
  for (const entry of breakdown) {
    if (typeof entry.multiplier !== 'number' || entry.multiplier === 1)
      continue;
    const known = MULTIPLIER_LABELS[entry.source];
    parts.push({
      source: entry.source,
      value: entry.multiplier,
      label:
        known?.label ??
        entry.source
          .replace(/[-_]multiplier$/i, '')
          .replace(/[-_]+/g, ' ')
          .toLowerCase(),
      labelKey: known?.key ?? 'gamification.multiplier.label',
    });
  }
  return parts;
}

function formatFactor(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function pickIntensity(kinds: RewardKind[]): HapticIntensity {
  const order: Record<HapticIntensity, number> = {
    light: 0,
    medium: 1,
    heavy: 2,
  };
  let best: HapticIntensity = 'light';
  for (const k of kinds)
    if (order[HAPTIC_FOR[k]] > order[best]) best = HAPTIC_FOR[k];
  return best;
}

function strongestKind(kinds: RewardKind[]): RewardKind {
  const priority: RewardKind[] = [
    'levelUp',
    'badgeUnlock',
    'leaguePromotion',
    'streakMilestone',
    'mysteryChestOpen',
  ];
  for (const p of priority) if (kinds.includes(p)) return p;
  return kinds[kinds.length - 1] ?? 'lessonComplete';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
