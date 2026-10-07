import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  ElementRef,
  viewChild,
} from '@angular/core';
import { teardownOverlayOnDestroy } from '../../internal/overlay-teardown.js';
import { TranslatePipe } from '@codify/i18n';
import { IonModal, IonContent } from '@ionic/angular/standalone';
import { tierForLevel } from '@codify/ui-core';
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
  imports: [IonModal, IonContent, Icon, AppButton, LevelBadge, TranslatePipe],
  template: `
    <ion-modal
      #modal
      [isOpen]="open()"
      [attr.aria-label]="'gamification.level.up' | translate"
      [backdropDismiss]="false"
      (didDismiss)="dismissed.emit()"
    >
      <ng-template>
        <ion-content class="cdf-levelup">
          <div class="cdf-levelup__inner">
            <cdf-icon name="rocket" size="xl" />
            <h2 class="cdf-levelup__title">
              {{ 'gamification.level.up' | translate }}
            </h2>
            <cdf-level-badge [level]="newLevel()" size="xl" />
            <p class="cdf-levelup__tier">
              {{ 'ui.tier.' + tier() | translate }}
            </p>
            @if (xpForNext(); as next) {
              <p class="cdf-levelup__next">
                {{
                  'ui.levelUp.toNext'
                    | translate: { xp: next, level: newLevel() + 1 }
                }}
              </p>
            }
            <cdf-app-button
              kind="primary"
              size="lg"
              (buttonClick)="dismissed.emit()"
            >
              {{ 'common.continue' | translate }}
            </cdf-app-button>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './level-up-modal.scss',
})
export class LevelUpModal {
  private readonly modalRef = viewChild('modal', { read: ElementRef });

  constructor() {
    teardownOverlayOnDestroy(this.modalRef);
  }

  readonly open = input.required<boolean>();
  readonly newLevel = input.required<number>();
  readonly xpForNext = input<number | null>(null);

  readonly dismissed = output<void>();

  /** Canonical tier from ui-core (same thresholds as LevelBadge / API). */
  protected readonly tier = computed(() => tierForLevel(this.newLevel()));
}
