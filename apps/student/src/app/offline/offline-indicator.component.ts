import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonNote,
} from '@ionic/angular/standalone';
import { AppButton, AppBadge, Icon } from '@codify/ui-ionic';
import { NetworkStatusService } from './network-status.service.js';
import { OfflineSyncService } from './offline-sync.service.js';

/**
 * Floating chip + slide-up sheet for offline / pending-sync state.
 * Shown when either the device is offline OR there are queued events
 * (per /docs/16-offline §10).
 *
 *   - Chip surfaces "Offline" or "N pending" with a cloud-off / clock icon.
 *   - Tap → modal listing the queue + a "Sync now" button.
 *   - The Sync now button is enabled only when online + queue > 0.
 */
@Component({
  selector: 'cdf-offline-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    AppButton,
    AppBadge,
    Icon,
  ],
  template: `
    @if (visible()) {
    <button
      type="button"
      class="offline-chip"
      data-testid="offline-chip"
      [attr.data-online]="online()"
      [attr.data-pending]="pending().length"
      (click)="open.set(true)"
    >
      @if (!online()) {
      <cdf-icon name="warning" size="xs" />
      <span>Offline</span>
      } @else if (pending().length > 0) {
      <cdf-icon name="hourglass" size="xs" />
      <span>{{ pending().length }} pending</span>
      }
    </button>
    }

    <ion-modal
      [isOpen]="open()"
      (didDismiss)="open.set(false)"
      [initialBreakpoint]="0.5"
      [breakpoints]="[0, 0.5, 0.9]"
      class="offline-sheet"
    >
      <ng-template>
        <ion-header>
          <ion-toolbar>
            <ion-title>Sync</ion-title>
            <ion-buttons slot="end">
              <cdf-app-button kind="ghost" size="sm" (buttonClick)="open.set(false)">
                Close
              </cdf-app-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <p class="offline-sheet__status">
            @if (online()) {
            <cdf-app-badge variant="success" [subtle]="true">Online</cdf-app-badge>
            } @else {
            <cdf-app-badge variant="warning" [subtle]="true">Offline</cdf-app-badge>
            }
          </p>
          @if (pending().length === 0) {
          <p class="offline-sheet__empty">No pending events.</p>
          } @else {
          <ion-list data-testid="offline-pending-list">
            @for (e of pending(); track e.clientEventId) {
            <ion-item [attr.data-pending-id]="e.clientEventId">
              <cdf-icon slot="start" name="hourglass" />
              <ion-label>
                <h3>Lesson completion</h3>
                <p>
                  Lesson {{ e.lessonId.slice(0, 8) }}… ·
                  {{ formatAge(e.clientTimestamp) }}
                  @if (e.attempts > 0) { · {{ e.attempts }} tries }
                </p>
                @if (e.lastError) {
                <p class="offline-sheet__err">{{ e.lastError }}</p>
                }
              </ion-label>
              <ion-note slot="end">queued</ion-note>
            </ion-item>
            }
          </ion-list>
          }
          <cdf-app-button
            kind="primary"
            size="md"
            data-testid="sync-now-btn"
            [disabled]="!online() || pending().length === 0 || flushing()"
            (buttonClick)="syncNow()"
          >
            @if (flushing()) { Syncing… } @else { Sync now }
          </cdf-app-button>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styles: [
    `
      .offline-chip {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + var(--cdf-space-2));
        right: var(--cdf-space-2);
        z-index: 30;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px var(--cdf-space-2);
        border-radius: 999px;
        background: var(--cdf-color-warning-subtle, #fff4d6);
        color: var(--cdf-color-warning-strong, #8a5a00);
        font-size: var(--cdf-font-size-xs);
        font-weight: 600;
        border: 1px solid var(--cdf-color-warning, #f5b800);
        cursor: pointer;
      }
      .offline-chip[data-online='true'] {
        background: var(--cdf-color-info-subtle, #e0f2fe);
        color: var(--cdf-color-info-strong, #0c4a6e);
        border-color: var(--cdf-color-info, #38bdf8);
      }
      .offline-sheet__status {
        margin: 0 0 var(--cdf-space-3);
      }
      .offline-sheet__empty {
        color: var(--cdf-color-text-muted);
      }
      .offline-sheet__err {
        color: var(--cdf-color-danger);
        font-size: var(--cdf-font-size-xs);
      }
    `,
  ],
})
export class OfflineIndicator {
  private readonly network = inject(NetworkStatusService);
  private readonly sync = inject(OfflineSyncService);

  protected readonly online = this.network.online;
  protected readonly pending = this.sync.pending;
  protected readonly flushing = this.sync.flushing;
  protected readonly open = signal(false);

  protected readonly visible = computed(
    () => !this.online() || this.pending().length > 0,
  );

  protected formatAge(ms: number): string {
    const delta = Date.now() - ms;
    if (delta < 60_000) return 'just now';
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
    return `${Math.floor(delta / 86_400_000)}d ago`;
  }

  protected async syncNow(): Promise<void> {
    await this.sync.flush();
  }
}
