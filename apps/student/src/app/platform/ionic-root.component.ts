import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  inject,
} from '@angular/core';
import {
  AngularDelegate,
  ConfigToken,
  provideComponentInputBinding,
} from '@ionic/angular/common';
import {
  IonApp,
  IonRouterOutlet,
  ModalController,
  PopoverController,
} from '@ionic/angular/standalone';
import { initialize, type IonicConfig } from '@ionic/core/components';
import { AppToastHost } from './app-toast-host.component.js';

/**
 * Material mode everywhere — closest to the "native feel" target per
 * docs/05-student-app §1 without per-platform visual drift.
 */
export const IONIC_CONFIG: IonicConfig = { mode: 'md' };

/**
 * The Ionic shell (`ion-app` + root `ion-router-outlet` + toast host),
 * loaded by the root `App` through `@defer` so `@ionic/angular` and
 * `@ionic/core` stay out of the initial bundle (docs/13 budget).
 *
 * Replaces `provideIonicAngular()`: the same providers are supplied here at
 * the element level (every routed page renders inside this outlet, so they
 * resolve them), and the constructor runs Ionic's `initialize(config)` +
 * `ion-ce` class exactly like its APP_INITIALIZER — before `ion-app` is
 * created. Nothing in the app injects Ionic overlay controllers from root
 * services; keep it that way (they would not see these providers).
 */
@Component({
  selector: 'cdf-ionic-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonApp, IonRouterOutlet, AppToastHost],
  providers: [
    { provide: ConfigToken, useValue: IONIC_CONFIG },
    provideComponentInputBinding(),
    AngularDelegate,
    ModalController,
    PopoverController,
  ],
  template: `<ion-app><ion-router-outlet /><cdf-app-toast-host /></ion-app>`,
})
export class IonicRoot {
  constructor() {
    inject(DOCUMENT).documentElement.classList.add('ion-ce');
    initialize(IONIC_CONFIG);
  }
}
