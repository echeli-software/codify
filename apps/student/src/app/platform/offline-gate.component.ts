import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { OfflineState } from '@codify/ui-ionic';
import { DownloadService } from '../offline/download.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { CapabilityService, type Capability } from './capability.service.js';

/**
 * Wraps an online-only surface. While the capability is unavailable it
 * renders the shared `OfflineState` with a capability-specific explanation
 * (and a "See downloads" shortcut when something is downloaded); otherwise
 * it projects its content unchanged.
 *
 *   <cdf-offline-gate capability="exercise">
 *     <cdf-exercise-runner … />
 *   </cdf-offline-gate>
 */
@Component({
  selector: 'cdf-offline-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OfflineState, TranslatePipe],
  template: `
    @if (available()) {
      <ng-content />
    } @else {
      <cdf-offline-state
        data-testid="offline-gate"
        [attr.data-capability]="capability()"
        [title]="caps.titleKey(capability()) | translate"
        [description]="caps.reasonKey(capability()) | translate"
        [queued]="sync.pendingCount()"
        [hasDownloads]="downloads.downloads().length > 0"
        (retry)="retry()"
        (openDownloads)="openDownloads()"
      />
    }
  `,
})
export class OfflineGate {
  readonly capability = input.required<Capability>();

  protected readonly caps = inject(CapabilityService);
  protected readonly sync = inject(OfflineSyncService);
  protected readonly downloads = inject(DownloadService);
  private readonly router = inject(Router);

  protected readonly available = computed(() =>
    this.caps.available(this.capability())(),
  );

  constructor() {
    void this.downloads.hydrate().catch(() => undefined);
  }

  protected retry(): void {
    // `online` is event-driven; a manual retry re-checks the hint and kicks
    // a sync attempt so queued progress goes out as soon as possible.
    void this.sync.flush();
  }

  protected openDownloads(): void {
    void this.router.navigateByUrl('/downloads');
  }
}
