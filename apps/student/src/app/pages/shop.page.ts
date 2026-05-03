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
        <ion-title>Shop</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="cart"
        title="Shop coming soon"
        description="Spend coins on cosmetics, freezes, and Mystery Chests."
      />
    </ion-content>
  `,
})
export class ShopPage {}
