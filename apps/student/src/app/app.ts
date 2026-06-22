import { Component, effect, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { AuthService } from '@codify/auth';
import { NativePlatformService } from './native/native-platform.service.js';

/**
 * Root of the student app: just the Ionic shell. Page-level chrome
 * (IonHeader / IonContent / tabs / sidebar) lives in each route component
 * so per-route layout choices stay local.
 *
 * On the native shell we register for push once the user is authenticated
 * (no-op on web). See /docs/11-mobile.md §Push.
 */
@Component({
  imports: [IonApp, IonRouterOutlet],
  selector: 'app-root',
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly native = inject(NativePlatformService);
  private pushRequested = false;

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated() && !this.pushRequested) {
        this.pushRequested = true;
        void this.native.registerForPush();
      }
    });
  }
}
