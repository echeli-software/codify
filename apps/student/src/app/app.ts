import { Component, Injector, afterNextRender, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { AppToastHost } from './platform/app-toast-host.component.js';

/**
 * Root of the student app: the Ionic shell plus the app-wide toast host.
 * Page-level chrome lives in each route component.
 *
 * After the first render the platform services (session lifecycle,
 * offline sync, telemetry, PWA updates, native hooks) start from a lazy
 * chunk — see `platform/boot.ts`.
 */
@Component({
  imports: [IonApp, IonRouterOutlet, AppToastHost],
  selector: 'app-root',
  template: `<ion-app><ion-router-outlet /><cdf-app-toast-host /></ion-app>`,
})
export class App {
  private readonly injector = inject(Injector);

  constructor() {
    afterNextRender(() => {
      import('./platform/boot')
        .then((m) => m.startPlatform(this.injector))
        .catch((err: unknown) =>
          console.error('[boot] platform start failed', err),
        );
    });
  }
}
