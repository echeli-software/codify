import { DestroyRef, Injectable, inject } from '@angular/core';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { AppToastService } from './app-toast.service.js';

/** How often a long-lived tab asks the service worker for a new build. */
const CHECK_EVERY_MS = 6 * 60 * 60_000;

/**
 * PWA update flow: when the service worker has downloaded a new build it
 * shows a persistent "New version available — Reload" toast; reloading
 * activates it. Also handles the SW's unrecoverable state (cache evicted
 * mid-version) by asking for a reload. No-op without a service worker
 * (dev server, native shell, unsupported browsers).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  start(): void {
    const sw = this.sw;
    if (this.started || !sw?.isEnabled) return;
    this.started = true;

    const sub = sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe((e) => {
        this.telemetry.track('app_update_ready', {
          from: e.currentVersion.hash.slice(0, 12),
          to: e.latestVersion.hash.slice(0, 12),
        });
        this.toast.show({
          message: 'studentPlatform.update.available',
          kind: 'info',
          durationMs: 0,
          action: {
            label: 'studentPlatform.update.reload',
            handler: () => void this.reload(),
          },
        });
      });
    const sub2 = sw.unrecoverable.subscribe(() => {
      this.toast.show({
        message: 'studentPlatform.update.broken',
        kind: 'warning',
        durationMs: 0,
        action: {
          label: 'studentPlatform.update.reload',
          handler: () => location.reload(),
        },
      });
    });
    const timer = setInterval(
      () => void sw.checkForUpdate().catch(() => false),
      CHECK_EVERY_MS,
    );
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      sub2.unsubscribe();
      clearInterval(timer);
    });
  }

  async reload(): Promise<void> {
    try {
      await this.sw?.activateUpdate();
    } finally {
      location.reload();
    }
  }
}
