import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type OnInit,
} from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import {
  CoinService,
  CoinTarget,
  MotionAndSoundService,
  OverlayHostService,
  RewardOrchestrator,
  SoundService,
  XpService,
  type BadgeUnlockOverlay as BadgeOverlayState,
  type LevelUpOverlay,
  type RewardKind,
  type RewardPayload,
} from '@codify/gamification-engine';
import { levelFromXp } from '@codify/ui-core';
import { AppButton } from '../atoms/app-button/app-button.js';
import { AppCard } from '../atoms/app-card/app-card.js';
import { CoinCounter } from '../molecules/coin-counter/coin-counter.js';
import { RewardToast } from '../molecules/reward-toast/reward-toast.js';
import { XpBar } from '../molecules/xp-bar/xp-bar.js';
import { LevelUpModal } from '../organisms/level-up-modal/level-up-modal.js';
import { BadgeUnlockOverlay } from '../organisms/badge-unlock-overlay/badge-unlock-overlay.js';

/** Fixed seed → coin trails and confetti replay identically every run. */
const DEMO_SEED = 20261007;

/** One canned server response per RewardKind (deltas + breakdown). */
const SCENARIOS: Record<
  RewardKind,
  Omit<RewardPayload, 'kind' | 'totals' | 'sourceEl'>
> = {
  lessonComplete: {
    canonical: {
      xp: 40,
      coins: 10,
      multiplier: 2,
      breakdown: [
        { source: 'base', xp: 20, coins: 5 },
        { source: 'PREMIUM_DEFAULT', multiplier: 2 },
      ],
    },
  },
  quizPass: {
    canonical: {
      xp: 72,
      coins: 18,
      multiplier: 2.4,
      breakdown: [
        { source: 'base', xp: 30, coins: 8 },
        { source: 'PREMIUM_DEFAULT', multiplier: 2 },
        { source: 'STREAK_TIER', multiplier: 1.2 },
      ],
    },
  },
  exercisePass: { canonical: { xp: 75, coins: 25 } },
  aiPromptComplete: { canonical: { xp: 30, coins: 8 } },
  scenarioComplete: { canonical: { xp: 35, coins: 12 } },
  dailyQuestComplete: { canonical: { xp: 50, coins: 20 } },
  streakMilestone: {
    canonical: { xp: 100, coins: 50 },
    badgesUnlocked: [
      {
        id: 'streak-7',
        name: 'Week Warrior',
        icon: 'flame',
        description: 'Held a 7-day learning streak.',
      },
    ],
  },
  levelUp: { canonical: { xp: 200, coins: 50 } },
  badgeUnlock: {
    canonical: { xp: 0, coins: 25 },
    badgesUnlocked: [
      {
        id: 'first-quiz',
        name: 'Quiz Whiz',
        icon: 'ribbon',
        description: 'Passed your first quiz.',
      },
    ],
  },
  leaguePromotion: {
    canonical: { xp: 0, coins: 100 },
    badgesUnlocked: [
      {
        id: 'league-silver',
        name: 'Silver League',
        icon: 'podium',
        description: 'Promoted to Silver.',
      },
    ],
  },
  mysteryChestOpen: { canonical: { xp: 15, coins: 120 } },
};

const KINDS = Object.keys(SCENARIOS) as RewardKind[];

/**
 * Storybook-only host for `OverlayHostService` (mirrors the student app's
 * RewardOverlays component) so overlays fire end-to-end.
 */
@Component({
  selector: 'sb-overlay-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LevelUpModal, BadgeUnlockOverlay],
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
  `,
})
class OverlayHostSb {
  private readonly overlays = inject(OverlayHostService);
  protected readonly levelUp = computed<LevelUpOverlay | null>(() => {
    const o = this.overlays.current();
    return o?.kind === 'level-up' ? o : null;
  });
  protected readonly badge = computed<BadgeOverlayState | null>(() => {
    const o = this.overlays.current();
    return o?.kind === 'badge-unlock' ? o : null;
  });
  protected dismiss(): void {
    this.overlays.dismiss();
  }
}

/**
 * docs/03 "A standalone RewardOrchestrator demo page plays each reward kind
 * on demand". Every RewardKind has a button; payloads carry server-style
 * `totals` (canonical), the seed is fixed so animations replay identically,
 * and the toggles exercise reduced-motion (toast instead of overlays) and
 * the persisted sound setting.
 */
@Component({
  selector: 'sb-reward-orchestrator-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AppButton,
    AppCard,
    CoinCounter,
    XpBar,
    RewardToast,
    CoinTarget,
    OverlayHostSb,
  ],
  template: `
    <cdf-app-card padding="spacious">
      <header class="sb-demo__head">
        <cdf-xp-bar [xp]="xp.displayed()" />
        <cdf-coin-counter
          cdfCoinTarget
          [value]="coins.displayed()"
          [animate]="false"
        />
      </header>

      <div #anchor class="sb-demo__grid">
        @for (kind of kinds; track kind) {
          <cdf-app-button
            [kind]="
              kind === 'levelUp' || kind === 'badgeUnlock'
                ? 'secondary'
                : 'primary'
            "
            (buttonClick)="grant(kind, $event)"
          >
            {{ kind }}
          </cdf-app-button>
        }
        <cdf-app-button kind="ghost" (buttonClick)="burst($event)"
          >3× lessonComplete (collapses)</cdf-app-button
        >
        <cdf-app-button kind="ghost" (buttonClick)="reset()"
          >Reset balances</cdf-app-button
        >
      </div>

      <div class="sb-demo__toggles">
        <label
          ><input
            type="checkbox"
            [checked]="reduced()"
            (change)="setReduced($any($event.target).checked)"
          />
          Reduced motion</label
        >
        <label
          ><input
            type="checkbox"
            [checked]="sound.soundEnabled()"
            (change)="sound.setSoundEnabled($any($event.target).checked)"
          />
          Sound</label
        >
      </div>

      <div class="sb-demo__toast" aria-live="polite">
        @if (orchestrator.toast(); as t) {
          <cdf-reward-toast
            [xp]="t.xp"
            [coins]="t.coins"
            [multiplier]="t.multiplier"
            [tone]="t.levelUp ? 'level-up' : 'plain'"
          />
          <p class="sb-demo__text">{{ t.text }}</p>
        }
      </div>
    </cdf-app-card>
    <sb-overlay-host />
  `,
  styles: [
    `
      .sb-demo__head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 16px;
      }
      .sb-demo__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 8px;
      }
      .sb-demo__toggles {
        display: flex;
        gap: 16px;
        margin-top: 16px;
        font-size: 14px;
      }
      .sb-demo__toast {
        min-height: 64px;
        margin-top: 16px;
      }
      .sb-demo__text {
        margin: 8px 0 0;
        font-size: 13px;
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
class RewardOrchestratorDemo implements OnInit {
  readonly reducedMotion = input(false);

  protected readonly xp = inject(XpService);
  protected readonly coins = inject(CoinService);
  protected readonly orchestrator = inject(RewardOrchestrator);
  protected readonly sound = inject(SoundService);
  private readonly motion = inject(MotionAndSoundService);
  protected readonly kinds = KINDS;
  protected readonly reduced = signal(false);
  protected readonly anchor = viewChild('anchor', { read: ElementRef });

  ngOnInit(): void {
    this.orchestrator.useSeed(DEMO_SEED);
    this.setReduced(this.reducedMotion());
    this.reset();
  }

  protected setReduced(on: boolean): void {
    this.reduced.set(on);
    this.motion.setMotionPref(on ? 'off' : 'on');
  }

  protected grant(kind: RewardKind, ev?: MouseEvent): void {
    const scenario = SCENARIOS[kind];
    const totalXp = this.xp.actual() + scenario.canonical.xp;
    const sourceEl =
      (ev?.currentTarget as HTMLElement | undefined) ??
      (this.anchor()?.nativeElement as HTMLElement | null) ??
      null;
    const newLevel = levelFromXp(totalXp);
    void this.orchestrator.grant({
      kind,
      ...scenario,
      // Simulated server snapshot — canonical totals win over deltas.
      totals: {
        totalXp,
        coins: this.coins.actual() + scenario.canonical.coins,
      },
      levelUp:
        kind === 'levelUp' || newLevel > levelFromXp(this.xp.actual())
          ? {
              newLevel: Math.max(newLevel, levelFromXp(this.xp.actual()) + 1),
              xpForNextLevel: 350,
            }
          : null,
      sourceEl,
    });
  }

  protected burst(ev: MouseEvent): void {
    // Three events inside the 800 ms window → one celebration.
    this.grant('lessonComplete', ev);
    setTimeout(() => this.grant('lessonComplete', ev), 150);
    setTimeout(() => this.grant('lessonComplete', ev), 300);
  }

  protected reset(): void {
    this.orchestrator.reconcile({
      totalXp: 100,
      coins: 50,
      streakDays: 6,
      freezesAvailable: 1,
    });
  }
}

const meta: Meta<RewardOrchestratorDemo> = {
  title: 'Demo/RewardOrchestrator',
  component: RewardOrchestratorDemo,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<RewardOrchestratorDemo>;

export const Playground: Story = { args: { reducedMotion: false } };

/** prefers-reduced-motion: no coin-fly / confetti / overlays — a toast carries level-up + badges. */
export const ReducedMotion: Story = { args: { reducedMotion: true } };
