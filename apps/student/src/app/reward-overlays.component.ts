import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '@codify/auth';
import { GamificationClient, LeaguesClient } from '@codify/api-client';
import {
  MotionAndSoundService,
  OverlayHostService,
  RewardOrchestrator,
  type RewardBonusLine,
  type RewardKind,
  type RewardMultiplierPart,
  type RewardToastEvent,
} from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  BadgeUnlockOverlay,
  CoinBadge,
  Icon,
  LevelUpModal,
  XpBadge,
} from '@codify/ui-ionic';
import { TelemetryService } from './telemetry/telemetry.service.js';
import { NetworkStatusService } from './offline/network-status.service.js';
import { leaguePromotionPayload } from './components/reward-grant.js';

/** How long the reward toast stays on screen. */
export const REWARD_TOAST_MS = 5000;

/** localStorage key: the last league week whose promotion was celebrated. */
export const LEAGUE_CELEBRATED_KEY = 'cdf.league.promotionCelebrated';

/** Localized "×2 Premium boost" fragments for a toast's multiplier parts. */
export function multiplierLabels(
  parts: readonly RewardMultiplierPart[],
  t: (key: string, params?: Record<string, unknown>) => string,
): string[] {
  return parts.map((p) => {
    const value = Math.round(p.value * 100) / 100;
    if (p.labelKey === 'gamification.multiplier.label') {
      return t(p.labelKey, { value });
    }
    return `×${value} ${t(p.labelKey)}`;
  });
}

/** "Perfect quiz: +10 XP · +5 coins" lines for the toast. */
export function bonusLabels(
  lines: readonly RewardBonusLine[],
  t: (key: string, params?: Record<string, unknown>) => string,
): string[] {
  return lines.map((b) => {
    const amounts: string[] = [];
    if (b.xp > 0) amounts.push(t('gamification.xp.earned', { value: b.xp }));
    if (b.coins > 0)
      amounts.push(
        b.coins === 1
          ? t('gamification.coin.earnedOne')
          : t('gamification.coin.earned', { value: b.coins }),
      );
    return t('gamification.reward.bonusLine', {
      label: t(b.labelKey),
      amounts: amounts.join(' · '),
    });
  });
}

/** Celebration kind for the `reward_celebration_shown` event. */
function celebrationKind(kinds: readonly RewardKind[]): string {
  if (kinds.includes('levelUp')) return 'level_up';
  if (kinds.includes('badgeUnlock')) return 'badge';
  if (kinds.includes('streakMilestone')) return 'streak_milestone';
  if (kinds.includes('leaguePromotion')) return 'league';
  return 'lesson';
}

/** mm:ss until `endsAt` (0:00 once past). */
export function countdown(endsAt: string, now = Date.now()): string {
  const s = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Mounts the orchestrator's UI, once in the AppShell, so any page can
 * `RewardOrchestrator.grant()` and get the celebration:
 *   - level-up / badge modals, streak-milestone and league-promotion
 *     celebrations (docs/07 §11);
 *   - the reward toast: gains, XP and coin factors separately ("why am I
 *     getting Xx?", docs/07 §3), bonus lines (perfect quiz, streak
 *     milestone), coins held for the weekly bonus, completed quests, the
 *     every-3-lessons micro-celebration and a surprise boost that started;
 *   - the league-promotion banner, which stays into the next route;
 *   - the surprise-boost countdown chip (docs/10 §6).
 * It also emits the reward analytics events (docs/10 §14: level_up,
 * badge_unlocked, quest_complete, streak_extended / _freeze_used / _lost)
 * and, on boot, picks up a running boost and celebrates last week's league
 * promotion once.
 */
@Component({
  selector: 'cdf-reward-overlays',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LevelUpModal,
    BadgeUnlockOverlay,
    XpBadge,
    CoinBadge,
    Icon,
    TranslatePipe,
  ],
  template: `
    @if (levelUp(); as lu) {
      <cdf-level-up-modal
        [open]="true"
        [newLevel]="lu.info.newLevel"
        [xpForNext]="lu.info.xpForNextLevel ?? null"
        (dismissed)="dismiss()"
      />
    }
    @if (badge(); as b) {
      <cdf-badge-unlock-overlay
        [open]="true"
        [name]="b.badge.name"
        [icon]="b.badge.icon"
        [description]="b.badge.description ?? null"
        (dismissed)="dismiss()"
      />
    }
    @if (celebration(); as c) {
      <div
        class="cel"
        data-testid="reward-celebration"
        tabindex="-1"
        (keydown.escape)="dismiss()"
      >
        <div
          class="cel__card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cel-title"
        >
          <p class="cel__eyebrow">{{ c.eyebrow | translate }}</p>
          <div class="cel__plate" [class.cel__plate--league]="c.league">
            <cdf-icon [name]="c.icon" size="xl" />
          </div>
          <h2 id="cel-title" class="cel__title">{{ c.title }}</h2>
          @if (c.body) {
            <p class="cel__body">{{ c.body }}</p>
          }
          @if (c.extra) {
            <p class="cel__body cel__body--strong">{{ c.extra }}</p>
          }
          <button
            #celBtn
            type="button"
            class="cel__btn"
            data-testid="reward-celebration-close"
            (click)="dismiss()"
          >
            {{ 'ui.celebration.awesome' | translate }}
          </button>
        </div>
      </div>
    }

    @if (banner(); as bn) {
      <div class="rb" role="status" data-testid="league-promotion-banner">
        <cdf-icon name="trophy" size="sm" />
        <span class="rb__text">{{
          'gamification.reward.leaguePromoted'
            | translate: { tier: 'ui.tier.' + bn.promotion.newTier | translate }
        }}</span>
        <button
          type="button"
          class="rb__close"
          [attr.aria-label]="'gamification.reward.bannerDismiss' | translate"
          (click)="dismissBanner()"
        >
          <cdf-icon name="close" size="xs" />
        </button>
      </div>
    }

    @if (boost(); as bo) {
      <div
        class="boost"
        data-testid="surprise-boost"
        [attr.aria-label]="
          'gamification.boost.label'
            | translate: { value: bo.value, time: boostLeft() }
        "
        role="timer"
      >
        <cdf-icon name="rocket" size="xs" />
        <span aria-hidden="true">{{
          'gamification.boost.chip' | translate: { value: bo.value }
        }}</span>
        <span class="boost__time" aria-hidden="true">{{ boostLeft() }}</span>
      </div>
    }

    <div class="rt" aria-live="polite" role="status">
      @if (toast(); as t) {
        <div
          class="rt__toast"
          data-testid="reward-toast"
          [attr.data-toast-id]="t.id"
        >
          <div class="rt__gains">
            @if (t.xp > 0) {
              <cdf-xp-badge [value]="t.xp" size="sm" tone="gain" />
            }
            @if (t.coins > 0) {
              <cdf-coin-badge
                [value]="t.coins"
                size="sm"
                tone="gain"
                [showLabel]="true"
              />
            }
          </div>
          @if (xpParts().length > 0) {
            <p class="rt__mult" data-testid="reward-multipliers">
              {{
                'gamification.reward.xpBoosted'
                  | translate: { parts: xpParts().join(' · ') }
              }}
            </p>
          }
          @if (coinParts().length > 0) {
            <p class="rt__mult" data-testid="reward-coin-multipliers">
              {{
                'gamification.reward.coinsBoosted'
                  | translate: { parts: coinParts().join(' · ') }
              }}
            </p>
          }
          @for (line of bonuses(); track $index) {
            <p class="rt__mult" data-testid="reward-bonus">{{ line }}</p>
          }
          @if (t.coinsPooled > 0) {
            <p class="rt__mult" data-testid="reward-pooled">
              {{
                'gamification.reward.pooled'
                  | translate: { count: t.coinsPooled }
              }}
            </p>
          }
          @for (q of t.quests; track q.id) {
            <p class="rt__extra" data-testid="reward-quest">
              {{ 'gamification.reward.quest' | translate: { title: q.title } }}
            </p>
          }
          @if (t.microCelebration; as n) {
            <p class="rt__extra" data-testid="reward-micro">
              {{ 'gamification.reward.micro' | translate: { count: n } }}
            </p>
          }
          @if (t.surpriseBoost; as sb) {
            <p class="rt__extra">
              {{
                'gamification.reward.boostStarted'
                  | translate: { value: sb.value, minutes: boostMinutes(sb) }
              }}
            </p>
          }
          @if (t.replacesOverlays && t.levelUp) {
            <p class="rt__extra">
              {{
                'student.reward.levelUp'
                  | translate: { level: t.levelUp.newLevel }
              }}
            </p>
          }
          @if (t.replacesOverlays && t.streakMilestone; as m) {
            <p class="rt__extra">
              {{
                'gamification.reward.streakMilestone'
                  | translate: { days: m.days }
              }}
            </p>
          }
          @if (t.replacesOverlays) {
            @for (b of t.badges; track b.id) {
              <p class="rt__extra">
                {{ 'student.reward.badge' | translate: { name: b.name } }}
              </p>
            }
          }
          <button
            type="button"
            class="rt__close"
            [attr.aria-label]="'common.close' | translate"
            (click)="hide()"
          >
            <cdf-icon name="close" size="sm" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .rt {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
        z-index: 1000;
        width: min(420px, calc(100vw - 32px));
        pointer-events: none;
      }
      .rt__toast {
        pointer-events: auto;
        position: relative;
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border: 1px solid var(--cdf-color-border);
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        padding: 12px 40px 12px 14px;
      }
      .rt__gains {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .rt__mult,
      .rt__extra {
        margin: 6px 0 0;
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
      .rt__extra {
        color: var(--cdf-color-text);
        font-weight: 600;
      }
      .rt__close,
      .rb__close {
        position: absolute;
        top: 6px;
        right: 6px;
        background: none;
        border: 0;
        padding: 6px;
        color: var(--cdf-color-text-muted);
        cursor: pointer;
        border-radius: 8px;
      }
      .rt__close:focus-visible,
      .rb__close:focus-visible,
      .cel__btn:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .rb {
        position: fixed;
        top: calc(64px + env(safe-area-inset-top, 0px));
        left: 50%;
        transform: translateX(-50%);
        z-index: 1001;
        width: min(480px, calc(100vw - 32px));
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 40px 10px 14px;
        border-radius: 12px;
        background: var(--cdf-color-primary, #6d28d9);
        color: var(--cdf-color-on-primary, #fff);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        font-weight: 600;
      }
      .rb__close {
        color: inherit;
        top: 50%;
        transform: translateY(-50%);
      }
      .rb__text {
        flex: 1;
        min-width: 0;
      }
      .boost {
        position: fixed;
        right: 16px;
        bottom: calc(136px + env(safe-area-inset-bottom, 0px));
        z-index: 999;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--cdf-color-xp, #7c3aed);
        color: #fff;
        font-weight: 700;
        font-size: var(--cdf-font-size-sm);
        box-shadow: 0 6px 18px rgba(124, 58, 237, 0.35);
      }
      .boost__time {
        font-variant-numeric: tabular-nums;
      }
      .cel {
        position: fixed;
        inset: 0;
        /* Above app sheets / Ionic overlays: a celebration is modal. */
        z-index: 30000;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.45);
      }
      .cel__card {
        width: min(360px, 100%);
        text-align: center;
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border-radius: 20px;
        padding: 24px 20px 20px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
      }
      .cel__eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
      .cel__plate {
        width: 84px;
        height: 84px;
        margin: 14px auto;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: #fff;
        background: radial-gradient(circle at 40% 30%, #ffb347, #ea580c);
      }
      .cel__plate--league {
        background: radial-gradient(circle at 40% 30%, #fde68a, #b45309);
      }
      .cel__title {
        margin: 0 0 6px;
        font-size: 1.35rem;
      }
      .cel__body {
        margin: 4px 0;
        color: var(--cdf-color-text-muted);
      }
      .cel__body--strong {
        color: var(--cdf-color-text);
        font-weight: 600;
      }
      .cel__btn {
        margin-top: 16px;
        width: 100%;
        min-height: 44px;
        border: 0;
        border-radius: 12px;
        background: var(--cdf-color-primary, #6d28d9);
        color: var(--cdf-color-on-primary, #fff);
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
      }
      @media (min-width: 768px) {
        .rt {
          bottom: 24px;
        }
        .boost {
          bottom: 96px;
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .rb {
          animation: cdf-pop 220ms ease-out;
        }
        .cel__card {
          animation: cdf-pop-card 220ms ease-out;
        }
      }
      @keyframes cdf-pop {
        from {
          opacity: 0;
          transform: translateX(-50%) scale(0.96);
        }
      }
      @keyframes cdf-pop-card {
        from {
          opacity: 0;
          transform: scale(0.96);
        }
      }
    `,
  ],
})
export class RewardOverlays {
  private readonly overlays = inject(OverlayHostService);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly motion = inject(MotionAndSoundService);
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly gamification = inject(GamificationClient);
  private readonly leagues = inject(LeaguesClient);

  protected readonly levelUp = computed(() => {
    const o = this.overlays.current();
    return o?.kind === 'level-up' ? o : null;
  });

  protected readonly badge = computed(() => {
    const o = this.overlays.current();
    return o?.kind === 'badge-unlock' ? o : null;
  });

  /** Streak-milestone / league-promotion celebration card. */
  protected readonly celebration = computed(() => {
    const o = this.overlays.current();
    this.i18n.currentLocale();
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t(k, p);
    if (o?.kind === 'streak-milestone') {
      const m = o.milestone;
      const gains = [
        m.xp > 0 ? t('gamification.xp.earned', { value: m.xp }) : null,
        m.coins > 0 ? t('gamification.coin.earned', { value: m.coins }) : null,
      ].filter(Boolean);
      return {
        eyebrow: 'gamification.reward.milestoneEyebrow',
        icon: 'flame' as const,
        league: false,
        title: t('gamification.reward.streakMilestone', { days: m.days }),
        body: gains.join(' · '),
        extra: m.item
          ? t('gamification.reward.milestoneItem', { name: m.item.name })
          : null,
      };
    }
    if (o?.kind === 'league-promotion') {
      const gains = [
        o.xp > 0 ? t('gamification.xp.earned', { value: o.xp }) : null,
        o.coins > 0 ? t('gamification.coin.earned', { value: o.coins }) : null,
      ].filter(Boolean);
      return {
        eyebrow: 'gamification.reward.leagueEyebrow',
        icon: 'trophy' as const,
        league: true,
        title: t('gamification.reward.leaguePromoted', {
          tier: t(`ui.tier.${o.promotion.newTier}`),
        }),
        body: gains.join(' · '),
        extra: null,
      };
    }
    return null;
  });

  /** The toast currently on screen (one per orchestration run). */
  protected readonly toast = signal<RewardToastEvent | null>(null);
  private readonly tr = (k: string, p?: Record<string, unknown>) =>
    this.i18n.t(k, p);
  protected readonly xpParts = computed(() => {
    const t = this.toast();
    this.i18n.currentLocale();
    return t ? multiplierLabels(t.xpParts ?? t.parts, this.tr) : [];
  });
  protected readonly coinParts = computed(() => {
    const t = this.toast();
    this.i18n.currentLocale();
    if (!t) return [];
    const xp = new Set((t.xpParts ?? t.parts).map((p) => p.source));
    // Factors shared with XP are already listed on the XP line.
    const coinOnly = (t.coinParts ?? []).filter((p) => !xp.has(p.source));
    return multiplierLabels(coinOnly, this.tr);
  });
  protected readonly bonuses = computed(() => {
    const t = this.toast();
    this.i18n.currentLocale();
    return t ? bonusLabels(t.bonuses ?? [], this.tr) : [];
  });

  protected readonly banner = this.orchestrator.banner;
  protected readonly boost = this.orchestrator.surpriseBoost;
  private readonly now = signal(Date.now());
  protected readonly boostLeft = computed(() => {
    const b = this.boost();
    return b ? countdown(b.endsAt, this.now()) : '';
  });

  private readonly celBtn = viewChild<ElementRef<HTMLButtonElement>>('celBtn');

  private lastId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Route changes since the banner appeared (it stays into the next route). */
  private bannerRoutes = 0;
  private bootChecked = false;

  constructor() {
    // Show each orchestrator toast exactly once (keyed by its id).
    effect(() => {
      const t = this.orchestrator.toast();
      if (!t || t.id === this.lastId) return;
      this.lastId = t.id;
      untracked(() => this.present(t));
    });
    // Move focus into the celebration dialog when it opens.
    effect(() => {
      const btn = this.celBtn();
      if (btn) setTimeout(() => btn.nativeElement.focus(), 0);
    });
    // Surprise boost countdown: tick every second while one runs.
    effect(() => {
      const b = this.boost();
      untracked(() => this.runTicker(b ? b.endsAt : null));
    });
    // League banner persists into the next route, then clears on the one after.
    effect(() => {
      if (this.banner()) this.bannerRoutes = 0;
    });
    const sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        if (!this.banner()) return;
        this.bannerRoutes += 1;
        if (this.bannerRoutes >= 2) this.orchestrator.dismissBanner();
      });
    // Boot: pick up a running boost; celebrate last week's promotion once.
    effect(() => {
      const user = this.auth.user();
      const online = this.network.online();
      if (!user || !online || this.bootChecked) return;
      this.bootChecked = true;
      untracked(() => void this.bootCheck());
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      if (this.ticker) clearInterval(this.ticker);
      sub.unsubscribe();
    });
  }

  private async bootCheck(): Promise<void> {
    try {
      const s = await this.gamification.summary();
      if (s.surpriseBoost)
        this.orchestrator.setSurpriseBoost({
          value: s.surpriseBoost.value,
          endsAt: s.surpriseBoost.endsAt,
          target: s.surpriseBoost.target,
        });
    } catch {
      // Display nicety only.
    }
    try {
      const lw = await this.leagues.lastWeek();
      if (!lw.promoted) return;
      let seen: string | null = null;
      try {
        seen = localStorage.getItem(LEAGUE_CELEBRATED_KEY);
      } catch {
        seen = null;
      }
      if (seen === lw.weekStart) return;
      try {
        localStorage.setItem(LEAGUE_CELEBRATED_KEY, lw.weekStart);
      } catch {
        // Private mode: the celebration may repeat next boot — harmless.
      }
      void this.orchestrator.grant(leaguePromotionPayload(lw));
    } catch {
      // 404 before the rollover / leagues off — nothing to celebrate.
    }
  }

  private runTicker(endsAt: string | null): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    if (!endsAt) return;
    this.now.set(Date.now());
    this.ticker = setInterval(() => {
      this.now.set(Date.now());
      if (Date.parse(endsAt) <= Date.now()) {
        this.orchestrator.setSurpriseBoost(null);
      }
    }, 1000);
  }

  private present(t: RewardToastEvent): void {
    this.trackRewardEvents(t);
    const visible =
      t.xp > 0 ||
      t.coins > 0 ||
      !!t.levelUp ||
      t.badges.length > 0 ||
      (t.quests ?? []).length > 0 ||
      !!t.streakMilestone ||
      !!t.leaguePromotion;
    if (!visible) return;
    this.toast.set(t);
    this.telemetry.track('reward_celebration_shown', {
      kind: celebrationKind(t.kinds),
      reducedMotion: this.motion.reducedMotion(),
    });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.toast.set(null), REWARD_TOAST_MS);
  }

  /** docs/10 §14 reward events, from the canonical server reward. */
  private trackRewardEvents(t: RewardToastEvent): void {
    if (t.levelUp)
      this.telemetry.track('level_up', { newLevel: t.levelUp.newLevel });
    for (const b of t.badges)
      this.telemetry.track('badge_unlocked', { badgeSlug: b.slug ?? b.id });
    for (const q of t.quests ?? [])
      this.telemetry.track('quest_complete', {
        questTemplateId: q.templateId ?? q.id,
        coins: q.coins,
        xp: q.xp,
      });
    const sc = t.streakChange;
    if (sc) {
      const props = {
        days: t.streakDays ?? 0,
        freezesLeft: t.freezesLeft ?? 0,
      };
      if (sc.restartedAfterLoss) this.telemetry.track('streak_lost', props);
      if (sc.freezesUsed > 0)
        this.telemetry.track('streak_freeze_used', {
          ...props,
          used: sc.freezesUsed,
        });
      if (sc.extended) this.telemetry.track('streak_extended', props);
    }
    if (t.streakMilestone)
      this.telemetry.track('streak_milestone', {
        days: t.streakMilestone.days,
        coins: t.streakMilestone.coins,
        xp: t.streakMilestone.xp,
      });
  }

  protected boostMinutes(b: { endsAt: string }): number {
    return Math.max(1, Math.round((Date.parse(b.endsAt) - Date.now()) / 60000));
  }

  protected hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.toast.set(null);
  }

  protected dismiss(): void {
    this.overlays.dismiss();
  }

  protected dismissBanner(): void {
    this.orchestrator.dismissBanner();
  }
}
