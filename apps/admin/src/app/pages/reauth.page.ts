import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { Button, EmptyState } from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';

/**
 * Re-authentication screen (docs/14 §1, §18): the API refused the session
 * because the account has no second factor (`MFA_REQUIRED`) or the sign-in
 * is older than 12 h (`SESSION_TOO_OLD`). Signing in again with Clerk
 * (with two-step verification) issues a fresh session.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, TranslatePipe],
  template: `
    <main class="reauth-shell">
      <cdf-empty-state
        icon="lock"
        [title]="titleKey() | translate"
        [description]="bodyKey() | translate: { hours: maxHours() }"
      >
        <cdf-button kind="primary" (click)="signInAgain()">
          {{ 'admin.reauth.signInAgain' | translate }}
        </cdf-button>
      </cdf-empty-state>
    </main>
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: var(--cdf-space-6);
      }
      .reauth-shell {
        max-width: 560px;
        padding: var(--cdf-space-6);
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-lg);
      }
    `,
  ],
})
export class ReauthPage {
  /** `?reason=` — MFA_REQUIRED | SESSION_TOO_OLD. */
  readonly reason = input<string | undefined>();
  /** `?hours=` — the staff session limit from the API (default 12). */
  readonly hours = input<string | undefined>();
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly maxHours = computed(() => {
    const n = Number(this.hours());
    return Number.isFinite(n) && n > 0 ? n : 12;
  });
  private readonly mfa = computed(() => this.reason() === 'MFA_REQUIRED');
  protected readonly titleKey = computed(() =>
    this.mfa() ? 'admin.reauth.mfaTitle' : 'admin.reauth.expiredTitle',
  );
  protected readonly bodyKey = computed(() =>
    this.mfa() ? 'admin.reauth.mfaBody' : 'admin.reauth.expiredBody',
  );

  protected async signInAgain(): Promise<void> {
    await this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
