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
import { Icon, ICON_NAMES, type IconName } from '../../atoms/icon/icon.js';
import { AppButton } from '../../atoms/app-button/app-button.js';

const ICON_SET = new Set<string>(ICON_NAMES);

/**
 * Full-screen celebration when a badge unlocks. The badge's icon, name,
 * and description take centre stage on a Lottie-style hero plate.
 *
 * Driven by `OverlayHostService` (gamification-engine). Stays simple
 * because confetti / sound / haptics are owned by the orchestrator.
 */
@Component({
  selector: 'cdf-badge-unlock-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonModal, IonContent, Icon, AppButton, TranslatePipe],
  template: `
    <ion-modal
      #modal
      [isOpen]="open()"
      [attr.aria-label]="
        ('gamification.badge.unlocked' | translate) + ' ' + name()
      "
      [backdropDismiss]="false"
      (didDismiss)="dismissed.emit()"
    >
      <ng-template>
        <ion-content class="cdf-badge-unlock">
          <div class="cdf-badge-unlock__inner">
            <p class="cdf-badge-unlock__eyebrow">
              {{ 'gamification.badge.unlocked' | translate }}
            </p>
            <div class="cdf-badge-unlock__plate">
              <cdf-icon [name]="iconName()" size="xl" />
            </div>
            <h2 class="cdf-badge-unlock__name">{{ name() }}</h2>
            @if (description(); as d) {
              <p class="cdf-badge-unlock__desc">{{ d }}</p>
            }
            <cdf-app-button
              kind="primary"
              size="lg"
              (buttonClick)="dismissed.emit()"
            >
              {{ 'ui.celebration.awesome' | translate }}
            </cdf-app-button>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './badge-unlock-overlay.scss',
})
export class BadgeUnlockOverlay {
  private readonly modalRef = viewChild('modal', { read: ElementRef });

  constructor() {
    teardownOverlayOnDestroy(this.modalRef);
  }

  readonly open = input.required<boolean>();
  readonly name = input.required<string>();
  readonly icon = input<string>('trophy');
  readonly description = input<string | null>(null);

  readonly dismissed = output<void>();

  // Fall back to 'trophy' if the requested icon isn't in the curated set —
  // safer than a runtime crash from an arbitrary BadgeRef.icon string.
  protected readonly iconName = computed<IconName>(() => {
    const i = this.icon();
    return ICON_SET.has(i) ? (i as IconName) : 'trophy';
  });
}
