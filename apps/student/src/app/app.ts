import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { NativePlatformService } from './native/native-platform.service.js';
import { OfflineSyncService } from './offline/offline-sync.service.js';
import { AppSessionService } from './platform/app-session.service.js';
import { AppToastHost } from './platform/app-toast-host.component.js';
import { AppUpdateService } from './platform/app-update.service.js';
import { TelemetryService } from './telemetry/telemetry.service.js';

/**
 * Root of the student app: the Ionic shell plus the app-wide toast host.
 * Page-level chrome lives in each route component.
 *
 * Boot wiring (all no-ops where unsupported):
 *   - AppSessionService — identity bundle, reward reconcile, RevenueCat +
 *     push on sign-in, clean sign-out (docs/16 §4, docs/17).
 *   - OfflineSyncService — arms the per-user queue flush triggers.
 *   - TelemetryService — batching + offline buffer (docs/10 §14).
 *   - AppUpdateService — "new version → reload" for the PWA.
 *   - NativePlatformService.init — Android back button + app state.
 */
@Component({
  imports: [IonApp, IonRouterOutlet, AppToastHost],
  selector: 'app-root',
  template: `<ion-app><ion-router-outlet /><cdf-app-toast-host /></ion-app>`,
})
export class App {
  private readonly session = inject(AppSessionService);
  protected readonly sync = inject(OfflineSyncService);
  private readonly telemetry = inject(TelemetryService);
  private readonly updates = inject(AppUpdateService);
  private readonly native = inject(NativePlatformService);

  constructor() {
    this.session.start();
    this.updates.start();
    void this.native.init();
    this.telemetry.track('app_opened', { online: navigator.onLine });
  }
}
