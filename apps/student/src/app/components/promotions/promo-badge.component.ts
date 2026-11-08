import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';
import {
  PromotionsService,
  promoTargetKey,
  promoValue,
} from './promotions.service.js';

/**
 * Corner badge "4x coins now!" for a course card or the lesson header
 * (docs/07 §3). Renders nothing when no course / lesson promo is running.
 * The host positions it (e.g. absolutely in a card corner).
 */
@Component({
  selector: 'cdf-promo-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, Icon],
  template: `
    @if (promo(); as p) {
      <span
        class="pb"
        data-testid="promo-badge"
        role="note"
        [attr.aria-label]="
          'gamification.promo.cornerLabel'
            | translate: { value: value(), what: targetKey() | translate }
        "
      >
        <cdf-icon name="rocket" size="xs" />
        <span aria-hidden="true">{{
          'gamification.promo.corner'
            | translate: { value: value(), what: targetKey() | translate }
        }}</span>
      </span>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .pb {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1.3;
        white-space: nowrap;
        color: #fff;
        background: linear-gradient(135deg, #f97316, #db2777);
        box-shadow: 0 2px 8px rgba(219, 39, 119, 0.35);
      }
    `,
  ],
})
export class PromoBadge {
  private readonly promotions = inject(PromotionsService);
  readonly courseId = input<string | null>(null);
  readonly lessonId = input<string | null>(null);

  protected readonly promo = computed(() =>
    this.promotions.promoFor(this.courseId(), this.lessonId()),
  );
  protected readonly value = computed(() => {
    const p = this.promo();
    return p ? promoValue(p) : '';
  });
  protected readonly targetKey = computed(() => {
    const p = this.promo();
    return p ? promoTargetKey(p) : '';
  });

  constructor() {
    void this.promotions.ensureLoaded();
  }
}
