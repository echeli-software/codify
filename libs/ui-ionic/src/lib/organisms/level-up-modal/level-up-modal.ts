import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { IonModal, IonContent } from '@ionic/angular/standalone';
import { Icon } from '../../atoms/icon/icon.js';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { LevelBadge } from '../../molecules/level-badge/level-badge.js';

/**
 * Full-screen celebration when the user crosses a level boundary. Shows
 * the new LevelBadge prominently, the tier name (BRONZE → MYTHIC), and a
 * "Continue" CTA. Confetti is fired by the orchestrator before this opens.
 *
 * Driven by `OverlayHostService` — keep it decoupled from any global
 * state so the org can also be triggered for previews / Storybook.
 */
@Component({
  selector: 'cdf-level-up-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonModal, IonContent, Icon, AppButton, LevelBadge],
  template: `
    <ion-modal
      [isOpen]="open()"
      [backdropDismiss]="false"
      (didDismiss)="dismissed.emit()"
    >
      <ng-template>
        <ion-content class="cdf-levelup">
          <div class="cdf-levelup__inner">
            <cdf-icon name="rocket" size="xl" />
            <h2 class="cdf-levelup__title">Level up!</h2>
            <cdf-level-badge [level]="newLevel()" size="xl" />
            <p class="cdf-levelup__tier">{{ tierLabel() }}</p>
            @if (xpForNext(); as next) {
            <p class="cdf-levelup__next">
              {{ next }} XP to level {{ newLevel() + 1 }}
            </p>
            }
            <cdf-app-button kind="primary" size="lg" (buttonClick)="dismissed.emit()">
              Continue
            </cdf-app-button>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './level-up-modal.scss',
})
export class LevelUpModal {
  readonly open = input.required<boolean>();
  readonly newLevel = input.required<number>();
  readonly xpForNext = input<number | null>(null);

  readonly dismissed = output<void>();

  protected readonly tierLabel = computed(() => {
    const lvl = this.newLevel();
    if (lvl >= 60) return 'Prestige';
    if (lvl >= 50) return 'Mythic';
    if (lvl >= 40) return 'Diamond';
    if (lvl >= 30) return 'Platinum';
    if (lvl >= 20) return 'Gold';
    if (lvl >= 10) return 'Silver';
    return 'Bronze';
  });
}
