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
import { flameBurst, xpSparkle } from './animation/sparkle.js';
import type {
  BadgeRef,
  HapticIntensity,
  LeaguePromotionRef,
  LevelUpInfo,
  QuestRef,
  RewardBanner,
  RewardBonusLine,
  RewardBreakdownEntry,
  RewardGrantResult,
  RewardKind,
  RewardMultiplierPart,
  RewardPayload,
  RewardServerState,
  RewardToastEvent,
  StreakChange,
  StreakMilestoneRef,
  SurpriseBoostRef,
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
  promoCode: 'medium',
};

/**
 * The first reward plays immediately; rewards arriving within this window
 * after it collapse into one follow-up celebration.
 */
export const REWARD_COLLAPSE_WINDOW_MS = 800;
/** docs/10 §1: a micro-celebration every N lessons within a session. */
export const MICRO_CELEBRATION_EVERY = 3;

/** Kinds that count as "a lesson done" for the session micro-celebration. */
const LESSON_KINDS: ReadonlySet<RewardKind> = new Set<RewardKind>([
  'lessonComplete',
  'quizPass',
  'exercisePass',
  'aiPromptComplete',
  'scenarioComplete',
]);

const BONUS_LABELS: Record<string, string> = {
  QUIZ_PERFECT: 'gamification.reward.bonus.quizPerfect',
  QUIZ_QUESTIONS: 'gamification.reward.bonus.quizQuestions',
  STREAK_MILESTONE: 'gamification.reward.bonus.streakMilestone',
};
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
  SURPRISE_BOOST: {
    label: 'surprise boost',
    key: 'gamification.multiplier.surpriseBoost',
  },
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
 *   T+0     haptic (strongest of the cluster) + one SFX
 *   T+0     coin trail (sourceEl → coin counter)
 *   T+200ms XP sparkles (sourceEl → XP counter); streak flame burst when a
 *           streak day was saved
 *   T+50ms  counters tween to the server's canonical totals
 *   then    reward toast event (`toast` signal) — caller renders it
 *   then    level-up, streak-milestone, badge and league-promotion overlays
 *           (queued; not awaited by `grant()` — `result.overlays` resolves
 *           on dismissal). A league promotion also sets `banner`, which
 *           the shell keeps on screen into the next route.
 *
 * RewardQueue: the FIRST reward plays immediately (target < 50 ms from the
 * API response) and opens a `REWARD_COLLAPSE_WINDOW_MS` window; rewards
 * arriving inside it collapse into ONE follow-up celebration played when
 * the window closes (not a trailing debounce, so a steady stream can't
 * postpone celebrations forever).
 *
 * Every 3rd lesson-type reward in a session sets `toast.microCelebration`
 * (+ a small confetti burst), docs/10 §1.
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

  private readonly bannerSig = signal<RewardBanner | null>(null);
  /** Persistent celebration banner (league promotion) until dismissed. */
  readonly banner = this.bannerSig.asReadonly();
  private bannerSeq = 0;

  private readonly boostSig = signal<SurpriseBoostRef | null>(null);
  /** The running surprise boost (from a reward or the boot summary). */
  readonly surpriseBoost = this.boostSig.asReadonly();

  /** Lesson-type rewards played this session (micro-celebration counter). */
  private sessionLessons = 0;

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
   * Queue a reward celebration. The first one plays right away; follow-ups
   * inside the collapse window are combined. Resolves once the counters
   * reached the canonical totals and the toast was emitted — NOT after
   * overlays are dismissed (await `result.overlays` for that). Never rejects.
   */
  grant(payload: RewardPayload): Promise<RewardGrantResult> {
    return new Promise<RewardGrantResult>((resolve) => {
      const item = { payload, resolve };
      if (this.windowTimer) {
        this.queue.push(item);
        return;
      }
      this.windowTimer = setTimeout(
        () => this.flush(),
        REWARD_COLLAPSE_WINDOW_MS,
      );
      this.runChain = this.runChain.then(() => this.run([item]));
    });
  }

  /** Show (or clear) the surprise-boost countdown, e.g. from the boot summary. */
  setSurpriseBoost(boost: SurpriseBoostRef | null): void {
    if (boost && Date.parse(boost.endsAt) <= Date.now()) boost = null;
    this.boostSig.set(boost);
  }

  /** Dismiss the persistent banner (close button, or the shell after a route). */
  dismissBanner(): void {
    this.bannerSig.set(null);
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
    const targetXp =
      c.totals?.totalXp ?? this.xp.actual() + (c.displayOnly ? 0 : c.xp);
    const targetCoins =
      c.totals?.coins ?? this.coins.actual() + (c.displayOnly ? 0 : c.coins);
    let micro: number | null = null;
    for (let i = 0; i < c.lessonKinds.length; i++) {
      this.sessionLessons += 1;
      if (this.sessionLessons % MICRO_CELEBRATION_EVERY === 0)
        micro = this.sessionLessons;
    }
    if (c.surpriseBoost) this.setSurpriseBoost(c.surpriseBoost);
    const toast = this.buildToast(c, reduced, micro);
    let overlays: Promise<void> = Promise.resolve();

    try {
      void this.haptics.impact(pickIntensity(c.kinds)).catch(() => undefined);
      void this.sound.play(strongestKind(c.kinds)).catch(() => undefined);

      if (!reduced) {
        if (c.streakChange?.extended)
          void flameBurst(10, { seed }).catch(() => undefined);
        if (c.sourceEl && c.xp > 0) {
          const src = c.sourceEl;
          setTimeout(
            () => void xpSparkle(src, 6, { seed }).catch(() => undefined),
            200,
          );
        }
        if (micro !== null) {
          const cx =
            typeof window !== 'undefined' ? window.innerWidth / 2 : 200;
          void confettiBurst({
            x: cx,
            y: 120,
            count: 24,
            seed: seed === null ? null : seed + 97,
          }).catch(() => undefined);
        }
      }

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
      if (c.leaguePromotion) {
        this.bannerSig.set({
          id: ++this.bannerSeq,
          kind: 'leaguePromotion',
          promotion: c.leaguePromotion,
          xp: c.xp,
          coins: c.coins,
        });
      }
      if (
        !reduced &&
        (c.levelUp ||
          c.badges.length > 0 ||
          c.streakMilestone ||
          c.leaguePromotion)
      ) {
        overlays = this.queueOverlays(c, seed);
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
    c: CollapsedPayload,
    seed: number | null,
  ): Promise<void> {
    const { levelUp, badges } = c;
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
      if (c.streakMilestone) {
        burst(50, 2);
        await this.overlays.showStreakMilestone(c.streakMilestone);
      }
      let i = 3;
      for (const badge of badges) {
        burst(40, i++);
        await this.overlays.showBadgeUnlock(badge);
      }
      if (c.leaguePromotion) {
        burst(60, i++);
        await this.overlays.showLeaguePromotion(c.leaguePromotion, {
          xp: c.xp,
          coins: c.coins,
        });
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

  private buildToast(
    c: CollapsedPayload,
    reduced: boolean,
    microCelebration: number | null = null,
  ): RewardToastEvent {
    const parts = multiplierParts(c.breakdown);
    const xpParts = multiplierParts(c.breakdown, 'xp');
    const coinParts = multiplierParts(c.breakdown, 'coins');
    const replacesOverlays =
      reduced &&
      (c.levelUp !== null ||
        c.badges.length > 0 ||
        c.streakMilestone !== null ||
        c.leaguePromotion !== null);
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
      if (c.streakMilestone)
        extra.push(`${c.streakMilestone.days}-day streak!`);
      for (const b of c.badges) extra.push(`Badge unlocked: ${b.name}`);
      if (c.leaguePromotion)
        extra.push(`Promoted to ${c.leaguePromotion.newTier}`);
      text = [text, ...extra].filter(Boolean).join(' · ');
    }
    return {
      id: ++this.toastSeq,
      kinds: c.kinds,
      xp: c.xp,
      coins: c.coins,
      multiplier: c.multiplier,
      parts,
      xpParts,
      coinParts,
      bonuses: bonusLines(c.breakdown),
      coinsPooled: c.coinsPooled,
      text,
      levelUp: c.levelUp,
      badges: c.badges,
      streakMilestone: c.streakMilestone,
      quests: c.quests,
      leaguePromotion: c.leaguePromotion,
      streakChange: c.streakChange,
      streakDays: c.totals?.streakDays ?? null,
      freezesLeft: c.totals?.freezesAvailable ?? null,
      microCelebration,
      surpriseBoost: c.surpriseBoost,
      replacesOverlays,
    };
  }
}

interface CollapsedPayload {
  kinds: RewardKind[];
  /** Lesson-type kinds of non-display-only payloads (micro-celebration). */
  lessonKinds: RewardKind[];
  xp: number;
  coins: number;
  multiplier: number | null;
  breakdown: RewardBreakdownEntry[];
  totals: RewardServerState | null;
  levelUp: LevelUpInfo | null;
  badges: BadgeRef[];
  sourceEl: HTMLElement | null;
  streakMilestone: StreakMilestoneRef | null;
  quests: QuestRef[];
  leaguePromotion: LeaguePromotionRef | null;
  streakChange: StreakChange | null;
  surpriseBoost: SurpriseBoostRef | null;
  coinsPooled: number;
  /** True only when every payload is display-only (counters stay put). */
  displayOnly: boolean;
}

/** Fold a window of payloads into one celebration. Exported for tests. */
export function collapse(payloads: RewardPayload[]): CollapsedPayload {
  const out: CollapsedPayload = {
    kinds: [],
    lessonKinds: [],
    xp: 0,
    coins: 0,
    multiplier: null,
    breakdown: [],
    totals: null,
    levelUp: null,
    badges: [],
    sourceEl: null,
    streakMilestone: null,
    quests: [],
    leaguePromotion: null,
    streakChange: null,
    surpriseBoost: null,
    coinsPooled: 0,
    displayOnly: payloads.length > 0 && payloads.every((p) => p.displayOnly),
  };
  let totalsAt = -Infinity;
  payloads.forEach((p, index) => {
    out.kinds.push(p.kind);
    if (LESSON_KINDS.has(p.kind) && !p.displayOnly)
      out.lessonKinds.push(p.kind);
    if (p.streakMilestone) {
      out.streakMilestone = p.streakMilestone;
      if (!out.kinds.includes('streakMilestone'))
        out.kinds.push('streakMilestone');
    }
    for (const q of p.questsCompleted ?? []) {
      if (!out.quests.some((x) => x.id === q.id)) out.quests.push(q);
    }
    if (out.quests.length && !out.kinds.includes('dailyQuestComplete'))
      out.kinds.push('dailyQuestComplete');
    if (p.leaguePromotion) out.leaguePromotion = p.leaguePromotion;
    if (p.streakChange) {
      const prev = out.streakChange;
      out.streakChange = {
        extended: (prev?.extended ?? false) || p.streakChange.extended,
        freezesUsed: (prev?.freezesUsed ?? 0) + p.streakChange.freezesUsed,
        restartedAfterLoss:
          (prev?.restartedAfterLoss ?? false) ||
          p.streakChange.restartedAfterLoss,
      };
    }
    if (p.surpriseBoost) out.surpriseBoost = p.surpriseBoost;
    out.coinsPooled += Math.max(0, p.coinsPooled ?? 0);
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
      if (!out.kinds.includes('levelUp')) out.kinds.push('levelUp');
    }
    if ((p.badgesUnlocked ?? []).length && !out.kinds.includes('badgeUnlock'))
      out.kinds.push('badgeUnlock');
    for (const b of p.badgesUnlocked ?? []) {
      if (!out.badges.some((x) => x.id === b.id)) out.badges.push(b);
    }
    if (!out.sourceEl && p.sourceEl) out.sourceEl = p.sourceEl;
  });
  return out;
}

/**
 * Multiplier factors (≠ 1) from a breakdown, labelled for the toast. `side`
 * keeps only the factors that apply to XP or to coins (`appliesTo`;
 * entries without it apply to both).
 */
export function multiplierParts(
  breakdown: readonly RewardBreakdownEntry[],
  side?: 'xp' | 'coins',
): RewardMultiplierPart[] {
  const parts: RewardMultiplierPart[] = [];
  for (const entry of breakdown) {
    if (typeof entry.multiplier !== 'number' || entry.multiplier === 1)
      continue;
    const applies = entry.appliesTo ?? 'both';
    if (side && applies !== 'both' && applies !== side) continue;
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

/** Bonus lines (perfect quiz, per-question, streak milestone) of a breakdown. */
export function bonusLines(
  breakdown: readonly RewardBreakdownEntry[],
): RewardBonusLine[] {
  const out: RewardBonusLine[] = [];
  for (const e of breakdown) {
    const key = BONUS_LABELS[e.source];
    if (!key) continue;
    const xp = Math.max(0, e.xp ?? 0);
    const coins = Math.max(0, e.coins ?? 0);
    if (xp === 0 && coins === 0) continue;
    out.push({ source: e.source, xp, coins, labelKey: key });
  }
  return out;
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
