import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Icon, type IconName } from '../../atoms/icon/icon.js';
import { AppButton } from '../../atoms/app-button/app-button.js';

export interface OnboardingSlide {
  id: string;
  title: string;
  body: string;
  icon: IconName;
}

/**
 * First-launch onboarding carousel. Three to five slides explaining the
 * value prop (gamified learning, daily quests, streak rewards). Final
 * slide swaps the "Next" CTA for "Get started" which emits `completed`.
 *
 * Uses a CSS scroll-snap row instead of bringing in Swiper — keeps the
 * bundle lean and the keyboard story simple.
 */
@Component({
  selector: 'cdf-onboarding-carousel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, AppButton, TranslatePipe],
  template: `
    <section
      class="cdf-onboarding"
      role="region"
      [attr.aria-roledescription]="'ui.onboarding.carousel' | translate"
      [attr.aria-label]="'ui.onboarding.label' | translate"
    >
      <div class="cdf-onboarding__top">
        <cdf-app-button kind="link" size="sm" (buttonClick)="skipped.emit()">
          {{ 'common.skip' | translate }}
        </cdf-app-button>
      </div>

      <div class="cdf-onboarding__viewport">
        @for (slide of slides(); track slide.id; let i = $index) {
          <div
            class="cdf-onboarding__slide"
            role="group"
            [attr.aria-roledescription]="'ui.onboarding.slide' | translate"
            [attr.aria-label]="
              'ui.onboarding.slideOf'
                | translate: { index: i + 1, total: slides().length }
            "
            [attr.aria-hidden]="i !== current()"
            [class.cdf-onboarding__slide--active]="i === current()"
          >
            <div class="cdf-onboarding__art">
              <cdf-icon [name]="slide.icon" size="xl" />
            </div>
            <h2 class="cdf-onboarding__title">{{ slide.title }}</h2>
            <p class="cdf-onboarding__body">{{ slide.body }}</p>
          </div>
        }
      </div>

      <ol class="cdf-onboarding__dots" aria-hidden="true">
        @for (slide of slides(); track slide.id; let i = $index) {
          <li
            class="cdf-onboarding__dot"
            [class.cdf-onboarding__dot--active]="i === current()"
          ></li>
        }
      </ol>

      <div class="cdf-onboarding__nav">
        <cdf-app-button
          kind="ghost"
          size="md"
          [disabled]="current() === 0"
          (buttonClick)="prev()"
        >
          {{ 'common.back' | translate }}
        </cdf-app-button>
        @if (isLast()) {
          <cdf-app-button
            kind="primary"
            size="md"
            (buttonClick)="completed.emit()"
          >
            {{ 'ui.onboarding.getStarted' | translate }}
          </cdf-app-button>
        } @else {
          <cdf-app-button kind="primary" size="md" (buttonClick)="next()">
            {{ 'common.next' | translate }}
          </cdf-app-button>
        }
      </div>
    </section>
  `,
  styleUrl: './onboarding-carousel.scss',
})
export class OnboardingCarousel {
  readonly slides = input.required<OnboardingSlide[]>();

  readonly skipped = output<void>();
  readonly completed = output<void>();
  readonly indexChanged = output<number>();

  protected readonly current = signal(0);

  protected readonly isLast = computed(
    () => this.current() === this.slides().length - 1,
  );

  protected next(): void {
    const next = Math.min(this.current() + 1, this.slides().length - 1);
    this.current.set(next);
    this.indexChanged.emit(next);
  }

  protected prev(): void {
    const prev = Math.max(this.current() - 1, 0);
    this.current.set(prev);
    this.indexChanged.emit(prev);
  }
}
