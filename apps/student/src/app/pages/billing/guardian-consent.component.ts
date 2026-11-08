import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  BillingClient,
  ProblemDetailsError,
  type GuardianConsentView,
} from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '@codify/ui-ionic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Which `student.age.guardian.*` message to show, if any. */
export type GuardianFormProblem =
  | 'required'
  | 'ownEmail'
  | 'tooMany'
  | 'failed';

/** Client-side check before POST /billing/guardian-consent (exported for tests). */
export function guardianFormProblem(v: {
  name: string;
  email: string;
  confirmed: boolean;
}): GuardianFormProblem | null {
  return v.name.trim().length >= 2 &&
    EMAIL_RE.test(v.email.trim()) &&
    v.confirmed
    ? null
    : 'required';
}

/**
 * Parent / guardian confirmation before a minor's web checkout (docs/09
 * "Guardian step"): name, email and the "I am 18 or older and this user's
 * parent or guardian" tick box. The API stores it (valid 24 h for this
 * price) and emails the guardian; `confirmed` lets checkout continue.
 */
@Component({
  selector: 'cdf-guardian-consent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, TranslatePipe],
  template: `
    <form
      class="gc"
      novalidate
      (submit)="submit($event)"
      aria-labelledby="gc-title"
      data-testid="guardian-consent"
    >
      <h3 id="gc-title" class="gc__title">
        {{ 'student.age.guardian.title' | translate }}
      </h3>
      <p class="gc__muted" id="gc-body">
        {{ 'student.age.guardian.body' | translate }}
      </p>
      <label class="gc__field" for="gc-name">
        <span>{{ 'student.age.guardian.name' | translate }}</span>
        <input
          id="gc-name"
          type="text"
          autocomplete="off"
          maxlength="120"
          data-testid="guardian-name"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
        />
      </label>
      <label class="gc__field" for="gc-email">
        <span>{{ 'student.age.guardian.email' | translate }}</span>
        <input
          id="gc-email"
          type="email"
          autocomplete="off"
          inputmode="email"
          maxlength="254"
          data-testid="guardian-email"
          [value]="email()"
          (input)="email.set($any($event.target).value)"
        />
      </label>
      <label class="gc__check" for="gc-confirm">
        <input
          id="gc-confirm"
          type="checkbox"
          data-testid="guardian-confirm"
          [checked]="confirmed()"
          (change)="confirmed.set($any($event.target).checked)"
        />
        <span>{{ 'student.age.guardian.confirm' | translate }}</span>
      </label>
      @if (problem(); as p) {
        <p class="gc__error" role="alert" data-testid="guardian-error">
          {{ 'student.age.guardian.' + p | translate }}
        </p>
      }
      <cdf-app-button
        kind="secondary"
        type="submit"
        [loading]="saving()"
        data-testid="guardian-submit"
        >{{ 'student.age.guardian.submit' | translate }}</cdf-app-button
      >
    </form>
  `,
  styles: [
    `
      .gc {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-3);
        border: 2px solid var(--cdf-color-border);
        border-radius: 14px;
        margin: var(--cdf-space-2) 0;
      }
      .gc__title {
        font-size: var(--cdf-font-size-md);
        margin: 0;
      }
      .gc__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0;
        line-height: 1.5;
      }
      .gc__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
      }
      .gc__field input {
        font: inherit;
        font-weight: 400;
        min-height: 44px;
        padding: 6px 10px;
        border-radius: 10px;
        border: 2px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        box-sizing: border-box;
        width: 100%;
      }
      .gc__check {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        font-size: var(--cdf-font-size-sm);
        line-height: 1.4;
      }
      .gc__check input {
        width: 22px;
        height: 22px;
        margin: 0;
        flex: none;
      }
      .gc__field input:focus-visible,
      .gc__check input:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .gc__error {
        color: var(--cdf-color-danger, #b91c1c);
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
        margin: 0;
      }
    `,
  ],
})
export class GuardianConsentComponent {
  readonly planPriceId = input.required<string>();
  readonly confirmedConsent = output<GuardianConsentView>();

  private readonly billing = inject(BillingClient);

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly confirmed = signal(false);
  protected readonly saving = signal(false);
  protected readonly problem = signal<GuardianFormProblem | null>(null);

  protected async submit(ev?: Event): Promise<void> {
    ev?.preventDefault();
    if (this.saving()) return;
    const v = {
      name: this.name(),
      email: this.email(),
      confirmed: this.confirmed(),
    };
    const local = guardianFormProblem(v);
    this.problem.set(local);
    if (local) return;
    this.saving.set(true);
    try {
      const consent = await this.billing.recordGuardianConsent({
        planPriceId: this.planPriceId(),
        guardianName: v.name.trim(),
        guardianEmail: v.email.trim(),
        confirmed: true,
      });
      this.confirmedConsent.emit(consent);
    } catch (err) {
      const code = err instanceof ProblemDetailsError ? err.code : undefined;
      this.problem.set(
        code === 'GUARDIAN_EMAIL_IS_STUDENT'
          ? 'ownEmail'
          : code === 'GUARDIAN_CONSENT_RATE_LIMITED'
            ? 'tooMany'
            : code === 'validation.failed'
              ? 'required'
              : 'failed',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
