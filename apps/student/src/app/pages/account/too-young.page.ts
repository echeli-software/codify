import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@codify/i18n';
import { AppCard, Icon } from '@codify/ui-ionic';

/**
 * Shown after a date of birth under 12 (docs/14 "Minors"): the API has
 * already deleted the account and the app has signed out
 * (`AppSessionService.endDeletedAccount`). Public route — no session.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    RouterLink,
    AppCard,
    Icon,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'studentPlatform.shell.brand' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <main class="young" data-testid="account-too-young">
        <cdf-app-card padding="spacious">
          <div class="young__icon" aria-hidden="true">
            <cdf-icon name="lock" size="lg" />
          </div>
          <h1>{{ 'student.age.tooYoung.title' | translate }}</h1>
          <p>{{ 'student.age.tooYoung.body' | translate }}</p>
          <p>{{ 'student.age.tooYoung.later' | translate }}</p>
          <p class="young__muted" role="status">
            {{ 'student.age.tooYoung.signedOut' | translate }}
          </p>
          <p>
            <a class="young__link" routerLink="/">{{
              'student.age.tooYoung.home' | translate
            }}</a>
          </p>
        </cdf-app-card>
      </main>
    </ion-content>
  `,
  styles: [
    `
      .young {
        max-width: 560px;
        margin: var(--cdf-space-4) auto 0;
      }
      .young__icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--cdf-color-primary-subtle, #ede9fe);
        color: var(--cdf-color-primary);
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
      .young__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .young__link {
        color: var(--cdf-color-primary);
        font-weight: 600;
      }
      .young__link:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class AccountTooYoungPage {}
