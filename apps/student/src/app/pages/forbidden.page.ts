import { Component } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { EmptyState, AppButton } from '@codify/ui-ionic';

/**
 * Shown when an authenticated user lands on a route their role can't see.
 * Plain "go home" affordance — the guard already redirected them.
 */
@Component({
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    EmptyState,
    AppButton,
    RouterLink,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.forbidden.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="shield"
        [title]="'student.forbidden.heading' | translate"
        [description]="'student.forbidden.body' | translate"
      >
        <cdf-app-button kind="primary" routerLink="/today">{{
          'student.forbidden.back' | translate
        }}</cdf-app-button>
      </cdf-empty-state>
    </ion-content>
  `,
})
export class ForbiddenPage {}
