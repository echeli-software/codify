import { Component } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import { EmptyState, AppButton } from '@codify/ui-ionic';
import { RouterLink } from '@angular/router';

/**
 * Shown when an authenticated user lands on a route their role can't see.
 * Plain "go home" affordance — there's no admin-style audit logging here
 * because the guard already redirected them.
 */
@Component({
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, EmptyState, AppButton, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Forbidden</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="shield"
        title="You can't access this page"
        description="Your account doesn't have the role required to see this section."
      >
        <cdf-app-button kind="primary" routerLink="/today">Back to Today</cdf-app-button>
      </cdf-empty-state>
    </ion-content>
  `,
})
export class ForbiddenPage {}
