import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { OverlayHostService } from '@codify/gamification-engine';
import { LevelUpModal, BadgeUnlockOverlay } from '@codify/ui-ionic';

/**
 * Mounts the orchestrator's overlay state into actual rendered modals.
 * Drop one of these inside the AppShell so the orchestrator can pop
 * level-up and badge-unlock modals from anywhere in the student app.
 *
 * Lives in the app (not in ui-ionic) to keep ui-ionic free of any
 * dependency on the gamification-engine — the engine is an app-level
 * orchestration concern.
 */
@Component({
  selector: 'cdf-reward-overlays',
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
export class RewardOverlays {
  private readonly overlays = inject(OverlayHostService);

  protected readonly levelUp = computed(() => {
    const o = this.overlays.current();
    return o?.kind === 'level-up' ? o : null;
  });

  protected readonly badge = computed(() => {
    const o = this.overlays.current();
    return o?.kind === 'badge-unlock' ? o : null;
  });

  protected dismiss(): void {
    this.overlays.dismiss();
  }
}
