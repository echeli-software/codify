import { Component } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import { EmptyState } from '@codify/ui-ionic';

@Component({
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, EmptyState],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Profile</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="person"
        title="Profile coming soon"
        description="Stats, badges, settings, and language choice will live here."
      />
    </ion-content>
  `,
})
export class ProfilePage {}
