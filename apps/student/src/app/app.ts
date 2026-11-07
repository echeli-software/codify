import { Component, Injector, afterNextRender, inject } from '@angular/core';
import { IonicRoot } from './platform/ionic-root.component.js';

/**
 * Root of the student app. The Ionic shell (`ion-app`, root outlet, toast
 * host) is a deferred block so Ionic loads as its own chunk right after
 * bootstrap instead of weighing on the initial bundle — see
 * `platform/ionic-root.component.ts`. Page-level chrome lives in each route
 * component.
 *
 * After the first render the platform services (session lifecycle,
 * offline sync, telemetry, PWA updates, native hooks) start from a lazy
 * chunk — see `platform/boot.ts`.
 */
@Component({
  imports: [IonicRoot],
  selector: 'app-root',
  template: `@defer (on immediate) {
    <cdf-ionic-root />
  }`,
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
