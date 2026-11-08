import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import {
  PromotionsService,
  promoTargetKey,
  promoValue,
} from './promotions.service.js';

const DISMISSED_KEY = 'cdf.promo.bannerDismissed';

/**
 * Campaign top banner (docs/07 §3: "Double-XP weekend — ends Sun 23:59"):
 * the running CAMPAIGN multiplier with its end in the user's locale and
 * zone. Dismissible per campaign (remembered on this device). Emits
 * `promo_banner_view` once per campaign per session (docs/10 §14).
 */
@Component({
  selector: 'cdf-promo-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LocalePipe, Icon],
  template: `
    @if (visible(); as c) {
      <div
        class="pbn"
        role="region"
        data-testid="promo-banner"
        [attr.aria-label]="
          'gamification.promo.banner'
            | translate: { value: value(), what: targetKey() | translate }
        "
      >
        <cdf-icon name="rocket" size="sm" />
        <p class="pbn__text">
          @if (c.endsAt) {
            {{
              'gamification.promo.bannerEnds'
                | translate
                  : {
                      value: value(),
                      what: targetKey() | translate,
                      end: c.endsAt | locale: 'datetime' : 'short',
                    }
            }}
          } @else {
            {{
              'gamification.promo.banner'
                | translate: { value: value(), what: targetKey() | translate }
            }}
          }
        </p>
        <button
          type="button"
          class="pbn__close"
          [attr.aria-label]="'gamification.promo.dismiss' | translate"
          (click)="dismiss(c.id)"
        >
          <cdf-icon name="close" size="xs" />
        </button>
      </div>
    }
  `,
  styles: [
    `
      .pbn {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 12px;
        padding: 8px 8px 8px 12px;
        border-radius: 12px;
        color: #fff;
        background: linear-gradient(90deg, #7c3aed, #db2777);
      }
      .pbn__text {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-weight: 600;
        font-size: var(--cdf-font-size-sm, 0.875rem);
      }
      .pbn__close {
        flex: none;
        background: none;
        border: 0;
        color: inherit;
        min-width: 32px;
        min-height: 32px;
        border-radius: 8px;
        cursor: pointer;
      }
      .pbn__close:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 1px;
      }
    `,
  ],
})
export class PromoBanner {
  private readonly promotions = inject(PromotionsService);
  private readonly telemetry = inject(TelemetryService);
  private readonly dismissed = signal<string | null>(readDismissed());
  private readonly tracked = new Set<string>();

  protected readonly visible = computed(() => {
    const c = this.promotions.campaign();
    return c && c.id !== this.dismissed() ? c : null;
  });
  protected readonly value = computed(() => {
    const c = this.visible();
    return c ? promoValue(c) : '';
  });
  protected readonly targetKey = computed(() => {
    const c = this.visible();
    return c ? promoTargetKey(c) : '';
  });

  constructor() {
    void this.promotions.ensureLoaded();
    effect(() => {
      const c = this.visible();
      if (!c || this.tracked.has(c.id)) return;
      this.tracked.add(c.id);
      untracked(() =>
        this.telemetry.track('promo_banner_view', {
          multiplierId: c.id,
          kind: c.kind,
          value: c.value,
        }),
      );
    });
  }

  protected dismiss(id: string): void {
    this.dismissed.set(id);
    try {
      localStorage.setItem(DISMISSED_KEY, id);
    } catch {
      // Per-device convenience only.
    }
  }
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}
