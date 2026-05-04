import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import {
  CoinService,
  CoinTarget,
  RewardOrchestrator,
  XpService,
} from '@codify/gamification-engine';
import { AppButton } from '../atoms/app-button/app-button.js';
import { AppCard } from '../atoms/app-card/app-card.js';
import { CoinBadge } from '../atoms/coin-badge/coin-badge.js';
import { XpBar } from '../molecules/xp-bar/xp-bar.js';
import { LevelUpModal } from '../organisms/level-up-modal/level-up-modal.js';
import { BadgeUnlockOverlay } from '../organisms/badge-unlock-overlay/badge-unlock-overlay.js';
import {
  OverlayHostService,
  type LevelUpOverlay,
  type BadgeUnlockOverlay as BadgeOverlayState,
} from '@codify/gamification-engine';
import { computed } from '@angular/core';

/**
 * Storybook-only host: mounts overlay state from `OverlayHostService` into
 * the actual modals. Mirrors `apps/student/src/app/reward-overlays.component`
 * but lives here so the catalog reviewer can see overlays fire end-to-end.
 */
@Component({
  selector: 'cdf-overlay-host-sb',
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
 * Self-contained demo for the RewardOrchestrator. Buttons trigger each
 * reward kind so a reviewer can watch the full sequence (haptic →
 * coin-fly → counter tween → overlay) end-to-end.
 */
@Component({
  selector: 'cdf-reward-orchestrator-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, AppCard, CoinBadge, XpBar, CoinTarget, OverlayHostSb],
  template: `
    <cdf-app-card padding="spacious">
      <header style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:16px;">
        <cdf-xp-bar [xp]="xp.displayed()" />
        <cdf-coin-badge cdfCoinTarget [value]="coins.displayed()" size="md" [showLabel]="true" />
      </header>

      <div #anchor style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">
        <cdf-app-button kind="primary" (buttonClick)="grant('lessonComplete', 25, 10)">
          +25 XP / +10 coins
        </cdf-app-button>
        <cdf-app-button kind="primary" (buttonClick)="grant('quizPass', 50, 15)">
          Quiz pass (+50/+15)
        </cdf-app-button>
        <cdf-app-button kind="primary" (buttonClick)="grant('exercisePass', 75, 25)">
          Exercise pass (+75/+25)
        </cdf-app-button>
        <cdf-app-button kind="secondary" (buttonClick)="levelUp()">
          Trigger level-up
        </cdf-app-button>
        <cdf-app-button kind="secondary" (buttonClick)="badge()">
          Trigger badge unlock
        </cdf-app-button>
        <cdf-app-button kind="ghost" (buttonClick)="reset()">
          Reset balances
        </cdf-app-button>
      </div>

      <p style="margin: 16px 0 0; color: var(--cdf-color-text-muted); font-size: 13px;">
        Click any reward — counters tween up, coins fly to the top-right
        badge, level-up + badge overlays cover the screen on demand.
      </p>
    </cdf-app-card>

    <cdf-overlay-host-sb />
  `,
})
class RewardOrchestratorDemo {
  protected readonly xp = inject(XpService);
  protected readonly coins = inject(CoinService);
  private readonly orchestrator = inject(RewardOrchestrator);

  protected readonly anchor = viewChild('anchor', { read: ElementRef });

  constructor() {
    this.orchestrator.reconcile({ totalXp: 100, coins: 50 });
  }

  protected grant(
    kind: 'lessonComplete' | 'quizPass' | 'exercisePass',
    xp: number,
    coins: number,
  ): void {
    void this.orchestrator.grant({
      kind,
      canonical: { xp, coins },
      sourceEl: (this.anchor()?.nativeElement as HTMLElement | undefined) ?? null,
    });
  }

  protected levelUp(): void {
    void this.orchestrator.grant({
      kind: 'levelUp',
      canonical: { xp: 200, coins: 50 },
      levelUp: { newLevel: this.xp.level() + 1, xpForNextLevel: 350 },
      sourceEl: (this.anchor()?.nativeElement as HTMLElement | undefined) ?? null,
    });
  }

  protected badge(): void {
    void this.orchestrator.grant({
      kind: 'badgeUnlock',
      canonical: { xp: 0, coins: 25 },
      badgesUnlocked: [
        {
          id: 'streak-7',
          name: 'Week Warrior',
          icon: 'flame',
          description: 'Held a 7-day learning streak.',
        },
      ],
      sourceEl: (this.anchor()?.nativeElement as HTMLElement | undefined) ?? null,
    });
  }

  protected reset(): void {
    this.orchestrator.reconcile({ totalXp: 100, coins: 50 });
    this.xp.snap();
    this.coins.snap();
  }
}

const meta: Meta<RewardOrchestratorDemo> = {
  title: 'Demo/RewardOrchestrator',
  component: RewardOrchestratorDemo,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<RewardOrchestratorDemo>;

export const Playground: Story = {
  render: () => ({
    template: `<cdf-reward-orchestrator-demo />`,
  }),
};
