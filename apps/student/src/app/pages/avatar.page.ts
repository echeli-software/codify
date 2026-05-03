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
        <ion-title>Avatar</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="person-circle"
        title="Avatar builder soon"
        description="Mix and match outfits, frames, and stickers earned from the shop."
      />
    </ion-content>
  `,
})
export class AvatarPage {}
