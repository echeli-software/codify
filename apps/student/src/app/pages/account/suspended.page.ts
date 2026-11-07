import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AccountClient } from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import { AppButton, AppCard, Icon } from '@codify/ui-ionic';
import { AppSessionService } from '../../platform/app-session.service.js';
import { AccountStateService } from './account-state.js';

/** Support inbox shown to suspended users. */
export const SUPPORT_EMAIL = 'support@codify.app';

/**
 * Shown when the API answers 403 ACCOUNT_SUSPENDED (docs/04 Users →
 * Suspend). The reason is staff-internal; the user gets the support
 * contact and can sign out (or check again after contacting support).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    Icon,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{
          'student.account.suspended.title' | translate
        }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <main class="acc" data-testid="account-suspended">
        <cdf-app-card padding="spacious">
          <div class="acc__icon" aria-hidden="true">
            <cdf-icon name="lock" size="lg" />
          </div>
          <h1>{{ 'student.account.suspended.heading' | translate }}</h1>
          <p>{{ 'student.account.suspended.body' | translate }}</p>
          <p>
            <a class="acc__link" [href]="'mailto:' + supportEmail">{{
              'student.account.suspended.contact'
                | translate: { email: supportEmail }
            }}</a>
          </p>
          <div class="acc__actions">
            <cdf-app-button kind="secondary" (buttonClick)="check()">{{
              'student.account.suspended.check' | translate
            }}</cdf-app-button>
            <cdf-app-button
              kind="ghost"
              [loading]="signingOut()"
              (buttonClick)="signOut()"
              data-testid="suspended-sign-out"
              >{{ 'common.signOut' | translate }}</cdf-app-button
            >
          </div>
        </cdf-app-card>
      </main>
    </ion-content>
  `,
  styles: [
    `
      .acc {
        max-width: 560px;
        margin: var(--cdf-space-4) auto 0;
      }
      .acc__icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--cdf-color-warning-subtle, #fef3c7);
        color: var(--cdf-color-warning, #b45309);
        margin-bottom: var(--cdf-space-2);
      }
      h1 {
        font-size: var(--cdf-font-size-lg);
        margin: 0 0 var(--cdf-space-2);
      }
      p {
        margin: 0 0 var(--cdf-space-2);
        line-height: 1.5;
      }
      .acc__link {
        color: var(--cdf-color-primary);
        font-weight: 600;
      }
      .acc__link:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .acc__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-3);
      }
    `,
  ],
})
export class AccountSuspendedPage {
  private readonly account = inject(AccountClient);
  private readonly state = inject(AccountStateService);
  private readonly session = inject(AppSessionService);
  private readonly router = inject(Router);
  protected readonly signingOut = this.session.signingOut;
  protected readonly supportEmail = SUPPORT_EMAIL;

  /** Lifted meanwhile? Back to the app. */
  protected async check(): Promise<void> {
    try {
      const s = await this.account.status();
      if (s.status === 'active') {
        this.state.clear();
        await this.router.navigateByUrl('/today');
      } else if (s.status === 'deleted') {
        this.state.set({ kind: 'deleted', restorableUntil: s.restorableUntil });
        await this.router.navigateByUrl('/account/restore');
      }
    } catch {
      // Still suspended (or offline): stay.
    }
  }

  protected async signOut(): Promise<void> {
    this.state.clear();
    await this.session.signOut();
  }
}
