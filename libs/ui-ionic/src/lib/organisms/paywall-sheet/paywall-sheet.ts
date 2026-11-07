import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
  signal,
  ElementRef,
  viewChild,
} from '@angular/core';
import { teardownOverlayOnDestroy } from '../../internal/overlay-teardown.js';
import { TranslatePipe } from '@codify/i18n';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonSegment,
  IonSegmentButton,
  IonLabel,
} from '@ionic/angular/standalone';
import { Icon } from '../../atoms/icon/icon.js';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';

export type PaywallReason =
  | 'lesson-locked'
  | 'course-locked'
  | 'limit-reached'
  | 'feature-locked'
  | 'soft';

export interface PaywallPlan {
  id: string;
  name: string;
  cadence: 'monthly' | 'yearly';
  /** Display string, already locale-formatted by the caller (e.g. "R$ 19,90/mo"). */
  priceLabel: string;
  /** Optional badge — e.g. "Best value", "Save 30%". */
  badge?: string | null;
  highlight?: boolean;
}

export interface PaywallContent {
  title: string;
  subtitle: string;
  /** Bullet list of perks shown above the plans. */
  perks: string[];
  plans: PaywallPlan[];
  /** Footer fine print — terms, restore-purchase, etc. */
  footnote?: string;
}

/** Default headline per reason — `ui.paywall.reason.<reason>` keys. */
const DEFAULT_REASON_KEY: Record<PaywallReason, string> = {
  'lesson-locked': 'ui.paywall.reason.lessonLocked',
  'course-locked': 'ui.paywall.reason.courseLocked',
  'limit-reached': 'ui.paywall.reason.limitReached',
  'feature-locked': 'ui.paywall.reason.featureLocked',
  soft: 'ui.paywall.reason.soft',
};

/**
 * Bottom-sheet paywall surfaced when the user hits a Premium gate. Driven
 * by `PaywallReason` for the headline / iconography, then renders the
 * marketing perks + a plan picker (segment) + the primary CTA.
 *
 * The component owns the local plan-selection state and emits the chosen
 * plan id on `selected`. The actual purchase (RevenueCat / Stripe) is
 * handled by the caller — see docs/08-monetization.md.
 */
@Component({
  selector: 'cdf-paywall-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    Icon,
    AppButton,
    AppBadge,
    TranslatePipe,
  ],
  template: `
    <ion-modal
      #modal
      [isOpen]="open()"
      [attr.aria-label]="title() ?? (titleKey() | translate)"
      [breakpoints]="[0, 0.85, 1]"
      [initialBreakpoint]="0.85"
      handleBehavior="cycle"
      (didDismiss)="dismissed.emit()"
    >
      <ng-template>
        <ion-header>
          <ion-toolbar>
            <ion-title>{{ title() ?? (titleKey() | translate) }}</ion-title>
            <ion-buttons slot="end">
              <cdf-app-button
                kind="ghost"
                size="sm"
                [ariaLabel]="'ui.paywall.close' | translate"
                (buttonClick)="dismissed.emit()"
              >
                <cdf-icon name="close" size="md" />
              </cdf-app-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>

        <ion-content class="ion-padding">
          <p class="cdf-paywall__subtitle">{{ content().subtitle }}</p>

          <ul class="cdf-paywall__perks">
            @for (perk of content().perks; track perk) {
              <li>
                <cdf-icon name="check-circle" size="sm" />
                <span>{{ perk }}</span>
              </li>
            }
          </ul>

          @if (cadenceOptions().length > 1) {
            <ion-segment
              [value]="activeCadence()"
              (ionChange)="onCadenceChange($any($event.detail.value))"
              class="cdf-paywall__cadence"
            >
              @for (cad of cadenceOptions(); track cad) {
                <ion-segment-button [value]="cad">
                  <ion-label>{{
                    'ui.paywall.cadence.' + cad | translate
                  }}</ion-label>
                </ion-segment-button>
              }
            </ion-segment>
          }

          <div
            class="cdf-paywall__plans"
            role="radiogroup"
            [attr.aria-label]="'ui.paywall.plans' | translate"
          >
            @for (plan of plansForCadence(); track plan.id) {
              <button
                type="button"
                class="cdf-paywall__plan"
                [class.cdf-paywall__plan--active]="plan.id === selectedPlanId()"
                [attr.aria-checked]="plan.id === selectedPlanId()"
                role="radio"
                (click)="selectPlan(plan.id)"
              >
                <span class="cdf-paywall__plan-name">{{ plan.name }}</span>
                <span class="cdf-paywall__plan-price">{{
                  plan.priceLabel
                }}</span>
                @if (plan.badge) {
                  <cdf-app-badge variant="success" [subtle]="true">{{
                    plan.badge
                  }}</cdf-app-badge>
                }
              </button>
            }
          </div>

          <div class="cdf-paywall__cta">
            <cdf-app-button kind="primary" (buttonClick)="confirm()">
              {{ 'common.continue' | translate }}
            </cdf-app-button>
          </div>

          @if (content().footnote) {
            <p class="cdf-paywall__footnote">{{ content().footnote }}</p>
          }
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './paywall-sheet.scss',
})
export class PaywallSheet {
  private readonly modalRef = viewChild('modal', { read: ElementRef });

  constructor() {
    teardownOverlayOnDestroy(this.modalRef);
  }

  readonly open = input.required<boolean>();
  readonly reason = input<PaywallReason>('soft');
  readonly content = input.required<PaywallContent>();
  /** Override default title derived from `reason`. */
  readonly title = input<string | null>(null);

  readonly dismissed = output<void>();
  readonly selected = output<string>();

  // Local UI state — cadence + plan picker.
  // Initialise from the first plan / its cadence.
  protected readonly cadenceOptions = computed(() => {
    const cads = new Set<'monthly' | 'yearly'>();
    for (const p of this.content().plans) cads.add(p.cadence);
    return Array.from(cads);
  });

  private readonly defaultPlan = computed(
    () =>
      this.content().plans.find((p) => p.highlight) ??
      this.content().plans[0] ??
      null,
  );

  private readonly cadenceOverride = signal<'monthly' | 'yearly' | null>(null);
  private readonly planOverride = signal<string | null>(null);

  protected readonly activeCadence = computed<'monthly' | 'yearly'>(
    () => this.cadenceOverride() ?? this.defaultPlan()?.cadence ?? 'monthly',
  );

  protected readonly plansForCadence = computed(() =>
    this.content().plans.filter((p) => p.cadence === this.activeCadence()),
  );

  protected readonly selectedPlanId = computed(() => {
    const override = this.planOverride();
    if (override) {
      const stillValid = this.plansForCadence().some((p) => p.id === override);
      if (stillValid) return override;
    }
    return this.plansForCadence()[0]?.id ?? '';
  });

  protected readonly titleKey = computed(
    () => DEFAULT_REASON_KEY[this.reason()],
  );

  protected onCadenceChange(value: 'monthly' | 'yearly' | string): void {
    if (value === 'monthly' || value === 'yearly') {
      this.cadenceOverride.set(value);
      this.planOverride.set(null);
    }
  }

  protected selectPlan(id: string): void {
    this.planOverride.set(id);
  }

  protected confirm(): void {
    const id = this.selectedPlanId();
    if (id) this.selected.emit(id);
  }
}
