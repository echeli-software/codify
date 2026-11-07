import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  MotionAndSoundService,
  OverlayHostService,
  RewardOrchestrator,
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

/** How long the reward toast stays on screen. */
export const REWARD_TOAST_MS = 5000;

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

/** Celebration kind for the `reward_celebration_shown` event. */
function celebrationKind(kinds: readonly RewardKind[]): string {
  if (kinds.includes('levelUp')) return 'level_up';
  if (kinds.includes('badgeUnlock')) return 'badge';
  if (kinds.includes('streakMilestone')) return 'streak_milestone';
  if (kinds.includes('leaguePromotion')) return 'league';
  return 'lesson';
}

/**
 * Mounts the orchestrator's UI: the level-up / badge-unlock modals and the
 * reward toast ("+40 XP · +10 coins · ×2 Premium boost"). Dropped once into
 * the AppShell, so any page can `RewardOrchestrator.grant()` and get the
 * celebration. Lives in the app (not ui-ionic) to keep ui-ionic free of a
 * dependency on the engine.
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
          @if (parts().length > 0) {
            <p class="rt__mult" data-testid="reward-multipliers">
              {{
                'student.reward.multipliers'
                  | translate: { parts: parts().join(' × ') }
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
      .rt__close {
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
      .rt__close:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
      }
      @media (min-width: 768px) {
        .rt {
          bottom: 24px;
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

  protected readonly levelUp = computed(() => {
    const o = this.overlays.current();
    return o?.kind === 'level-up' ? o : null;
  });

  protected readonly badge = computed(() => {
    const o = this.overlays.current();
    return o?.kind === 'badge-unlock' ? o : null;
  });

  /** The toast currently on screen (one per orchestration run). */
  protected readonly toast = signal<RewardToastEvent | null>(null);
  protected readonly parts = computed(() => {
    const t = this.toast();
    this.i18n.currentLocale();
    return t ? multiplierLabels(t.parts, (k, p) => this.i18n.t(k, p)) : [];
  });

  private lastId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Show each orchestrator toast exactly once (keyed by its id).
    effect(() => {
      const t = this.orchestrator.toast();
      if (!t || t.id === this.lastId) return;
      this.lastId = t.id;
      untracked(() => this.present(t));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  private present(t: RewardToastEvent): void {
    if (t.xp <= 0 && t.coins <= 0 && !t.levelUp && t.badges.length === 0)
      return;
    this.toast.set(t);
    this.telemetry.track('reward_celebration_shown', {
      kind: celebrationKind(t.kinds),
      reducedMotion: this.motion.reducedMotion(),
    });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.toast.set(null), REWARD_TOAST_MS);
  }

  protected hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.toast.set(null);
  }

  protected dismiss(): void {
    this.overlays.dismiss();
  }
}
