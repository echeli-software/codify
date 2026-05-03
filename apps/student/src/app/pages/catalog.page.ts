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
        <ion-title>Catalog</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="school"
        title="Catalog coming soon"
        description="Browse all courses, filter by category, and pick what's next."
      />
    </ion-content>
  `,
})
export class CatalogPage {}
