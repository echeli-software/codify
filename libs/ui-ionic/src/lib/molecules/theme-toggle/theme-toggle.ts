import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import {
  IonSegment,
  IonSegmentButton,
  IonLabel,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';
import { ThemeService, type ThemeMode } from './theme.service.js';

/**
 * Light / dark / system segmented control bound to `ThemeService`.
 *
 *   <cdf-theme-toggle />
 */
@Component({
  selector: 'cdf-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, IonSegmentButton, IonLabel, Icon, TranslatePipe],
  template: `
    <ion-segment
      class="cdf-theme-toggle"
      [value]="theme.mode()"
      [attr.aria-label]="'common.theme.label' | translate"
      (ionChange)="set($any($event).detail.value)"
    >
      @for (m of modes; track m.mode) {
        <ion-segment-button [value]="m.mode">
          <cdf-icon [name]="m.icon" size="sm" />
          <ion-label>{{ 'common.theme.' + m.mode | translate }}</ion-label>
        </ion-segment-button>
      }
    </ion-segment>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 360px;
      }
    `,
  ],
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly modes = [
    { mode: 'light', icon: 'sun' },
    { mode: 'dark', icon: 'moon' },
    { mode: 'system', icon: 'settings' },
  ] as const;

  protected set(mode: ThemeMode | string | undefined): void {
    if (mode === 'light' || mode === 'dark' || mode === 'system')
      this.theme.setMode(mode);
  }
}
