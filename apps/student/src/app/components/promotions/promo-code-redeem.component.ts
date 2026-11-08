import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { PromoCodesClient, toProblemDetails } from '@codify/api-client';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '@codify/ui-ionic';

const KNOWN_ERRORS = new Set([
  'PROMO_CODE_NOT_FOUND',
  'PROMO_CODE_NOT_STARTED',
  'PROMO_CODE_EXPIRED',
  'PROMO_CODE_ALREADY_REDEEMED',
  'PROMO_CODE_EXHAUSTED',
  'PROMO_CODE_RATE_LIMITED',
]);

/** i18n key for a failed redemption's problem `code`. */
export function promoCodeErrorKey(code: string | undefined): string {
  return code && KNOWN_ERRORS.has(code)
    ? `gamification.promoCode.errors.${code}`
    : 'gamification.promoCode.errors.generic';
}

/**
 * "Have a promo code?" (docs/08 §12): redeems through
 * POST /me/promo-codes/redeem and plays the coins through the
 * RewardOrchestrator (counters land on the server totals).
 */
@Component({
  selector: 'cdf-promo-code-redeem',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, AppButton],
  template: `
    <form class="pcr" data-testid="promo-code-redeem" (submit)="submit($event)">
      <h2 class="pcr__title">
        {{ 'gamification.promoCode.title' | translate }}
      </h2>
      <label class="pcr__label" for="promo-code-input">{{
        'gamification.promoCode.label' | translate
      }}</label>
      <div class="pcr__row">
        <input
          id="promo-code-input"
          class="pcr__input"
          name="code"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="32"
          [placeholder]="'gamification.promoCode.placeholder' | translate"
          [value]="code()"
          [attr.aria-describedby]="message() ? 'promo-code-msg' : null"
          [attr.aria-invalid]="error() ? true : null"
          (input)="code.set($any($event.target).value)"
        />
        <cdf-app-button
          type="submit"
          kind="primary"
          [loading]="busy()"
          [disabled]="busy() || code().trim().length < 3"
        >
          {{ 'gamification.promoCode.submit' | translate }}
        </cdf-app-button>
      </div>
      <p
        id="promo-code-msg"
        class="pcr__msg"
        [class.pcr__msg--error]="error()"
        role="status"
        aria-live="polite"
      >
        @if (message(); as m) {
          {{ m.key | translate: m.params }}
        }
      </p>
    </form>
  `,
  styles: [
    `
      .pcr {
        display: grid;
        gap: 6px;
      }
      .pcr__title {
        margin: 0 0 4px;
        font-size: 1rem;
      }
      .pcr__label {
        font-size: var(--cdf-font-size-sm, 0.875rem);
        color: var(--cdf-color-text-muted);
      }
      .pcr__row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .pcr__input {
        flex: 1 1 160px;
        min-width: 0;
        min-height: 44px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        font: inherit;
        text-transform: uppercase;
      }
      .pcr__input:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 1px;
      }
      .pcr__msg {
        margin: 0;
        min-height: 1.2em;
        font-size: var(--cdf-font-size-sm, 0.875rem);
        color: var(--cdf-color-success, #15803d);
      }
      .pcr__msg--error {
        color: var(--cdf-color-danger, #b91c1c);
      }
    `,
  ],
})
export class PromoCodeRedeem {
  private readonly client = inject(PromoCodesClient);
  private readonly orchestrator = inject(RewardOrchestrator);

  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal(false);
  protected readonly message = signal<{
    key: string;
    params?: Record<string, unknown>;
  } | null>(null);

  protected async submit(ev: Event): Promise<void> {
    ev.preventDefault();
    const code = this.code().trim();
    if (code.length < 3 || this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const res = await this.client.redeem(code);
      this.error.set(false);
      this.message.set({
        key: 'gamification.promoCode.success',
        params: { coins: res.coins },
      });
      this.code.set('');
      void this.orchestrator.grant({
        kind: 'promoCode',
        canonical: { xp: 0, coins: res.coins },
        totals: { totalXp: res.totals.totalXp, coins: res.totals.coins },
      });
    } catch (err) {
      this.error.set(true);
      this.message.set({ key: promoCodeErrorKey(toProblemDetails(err).code) });
    } finally {
      this.busy.set(false);
    }
  }
}
