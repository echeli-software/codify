import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCardSubtitle } from '@ionic/angular/standalone';

export type AppCardElevation = 'flat' | 'raised';
export type AppCardPadding = 'none' | 'compact' | 'normal' | 'spacious';

/**
 * Branded card. Wraps Ionic's card primitives so pages can drop in a
 * consistent surface without composing 4 ion-card-* elements every time.
 *
 *   <cdf-app-card title="Today's lesson" subtitle="React Fundamentals">
 *     ...content...
 *   </cdf-app-card>
 *
 * For just a surface (no header), omit `title` and the header doesn't render.
 * Linkable-card mode (RouterLink integration) lands when a feature actually
 * needs it — keep this atom dependency-light for now.
 */
@Component({
  selector: 'cdf-app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCardSubtitle],
  host: {
    '[attr.data-elevation]': 'elevation()',
    '[attr.data-padding]': 'padding()',
  },
  template: `
    <ion-card>
      @if (title()) {
      <ion-card-header>
        <ion-card-title>{{ title() }}</ion-card-title>
        @if (subtitle()) {
        <ion-card-subtitle>{{ subtitle() }}</ion-card-subtitle>
        }
      </ion-card-header>
      }
      <ion-card-content>
        <ng-content />
      </ion-card-content>
    </ion-card>
  `,
  styleUrl: './app-card.scss',
})
export class AppCard {
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly elevation = input<AppCardElevation>('raised');
  readonly padding = input<AppCardPadding>('normal');
}
