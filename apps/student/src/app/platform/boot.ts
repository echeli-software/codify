import type { Injector } from '@angular/core';
import { NativePlatformService } from '../native/native-platform.service';
import { OfflineSyncService } from '../offline/offline-sync.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { AppSessionService } from './app-session.service';
import { AppUpdateService } from './app-update.service';

/**
 * App-wide services started right after the first render (lazy chunk, so
 * they don't weigh on the initial bundle):
 *   - AppSessionService — identity bundle, reward reconcile, RevenueCat +
 *     push on sign-in, clean sign-out (docs/16 §4, docs/17).
 *   - OfflineSyncService — arms the per-user queue flush triggers.
 *   - TelemetryService — batching + offline buffer (docs/10 §14).
 *   - AppUpdateService — "new version → reload" for the PWA.
 *   - NativePlatformService.init — Android back button + app state.
 */
export function startPlatform(injector: Injector): void {
  injector.get(AppSessionService).start();
  injector.get(OfflineSyncService);
  injector.get(AppUpdateService).start();
  void injector.get(NativePlatformService).init();
  injector
    .get(TelemetryService)
    .track('app_opened', {
      online: typeof navigator === 'undefined' || navigator.onLine,
    });
}
