import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { AppBadge, AppButton, BottomSheet, Icon } from '@codify/ui-ionic';
import { NetworkStatusService } from './network-status.service.js';
import { OfflineSyncService } from './offline-sync.service.js';
import type { QueuedEvent } from './event-queue.js';

/**
 * Header chip + sheet for offline / pending-sync state (docs/16 §10).
 * Visible when the device is offline, there are queued events, or the
 * queue is blocked waiting for the same user to sign in again.
 *
 *   - Chip: "Offline" / "3 to sync" / "Sign in to sync".
 *   - Tap → sheet listing what's pending ("Lesson 'Hooks' completed —
 *     waiting to sync"), "Sync now", and per-item Retry / Discard for events
 *     that exhausted automatic retries.
 */
@Component({
  selector: 'cdf-offline-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBadge, AppButton, BottomSheet, Icon, LocalePipe, TranslatePipe],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="offline-chip"
        data-testid="offline-chip"
        [attr.data-online]="online()"
        [attr.data-pending]="pending().length"
        [attr.aria-label]="'studentPlatform.offline.openSheet' | translate"
        (click)="open.set(true)"
      >
        @if (!online()) {
          <cdf-icon name="cloud-offline" size="xs" />
          <span>{{ 'studentPlatform.offline.chipOffline' | translate }}</span>
        } @else if (blocked()) {
          <cdf-icon name="log-in" size="xs" />
          <span>{{ 'studentPlatform.offline.chipSignIn' | translate }}</span>
        } @else {
          <cdf-icon name="hourglass" size="xs" />
          <span>{{
            'studentPlatform.offline.chipPending'
              | translate: { count: pending().length }
          }}</span>
        }
      </button>
    }

    <cdf-bottom-sheet
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="'studentPlatform.offline.sheetTitle' | translate"
    >
      <p class="sheet__status">
        @if (online()) {
          <cdf-app-badge variant="success" [subtle]="true">{{
            'studentPlatform.offline.online' | translate
          }}</cdf-app-badge>
        } @else {
          <cdf-app-badge variant="warning" [subtle]="true">{{
            'studentPlatform.offline.offline' | translate
          }}</cdf-app-badge>
          <span class="sheet__hint">{{
            'studentPlatform.offline.offlineBanner' | translate
          }}</span>
        }
      </p>
      @if (blocked()) {
        <p class="sheet__warn" role="alert">
          {{ 'studentPlatform.sync.signInAgain' | translate }}
        </p>
      }
      @if (pending().length === 0) {
        <p class="sheet__empty">
          {{ 'studentPlatform.offline.nothingPending' | translate }}
        </p>
      } @else {
        <ul class="sheet__list" data-testid="offline-pending-list">
          @for (e of pending(); track e.clientEventId) {
            <li class="item" [attr.data-pending-id]="e.clientEventId">
              <cdf-icon [name]="e.stuck ? 'warning' : 'hourglass'" size="sm" />
              <div class="item__body">
                <strong>{{
                  describeKey(e) | translate: { title: e.lessonTitle ?? '' }
                }}</strong>
                <span class="item__meta">
                  {{ e.clientTimestamp | locale: 'relative' }}
                  @if (e.attempts > 0) {
                    ·
                    {{
                      'studentPlatform.offline.attempts'
                        | translate: { count: e.attempts }
                    }}
                  }
                </span>
                @if (e.stuck) {
                  <span class="item__err">{{
                    'studentPlatform.offline.stuck' | translate
                  }}</span>
                }
              </div>
              @if (confirmDiscard() === e.clientEventId) {
                <cdf-app-button
                  kind="danger"
                  size="sm"
                  (buttonClick)="discard(e)"
                >
                  {{ 'studentPlatform.offline.confirmDiscard' | translate }}
                </cdf-app-button>
                <cdf-app-button
                  kind="ghost"
                  size="sm"
                  (buttonClick)="confirmDiscard.set(null)"
                >
                  {{ 'common.cancel' | translate }}
                </cdf-app-button>
              } @else if (e.stuck) {
                <cdf-app-button
                  kind="ghost"
                  size="sm"
                  (buttonClick)="confirmDiscard.set(e.clientEventId)"
                >
                  {{ 'studentPlatform.offline.discard' | translate }}
                </cdf-app-button>
              }
            </li>
          }
        </ul>
      }
      <div sheetFooter class="sheet__foot">
        <cdf-app-button kind="ghost" size="md" (buttonClick)="openDownloads()">
          {{ 'studentPlatform.offline.manageDownloads' | translate }}
        </cdf-app-button>
        <cdf-app-button
          kind="primary"
          size="md"
          data-testid="sync-now-btn"
          [loading]="flushing()"
          [disabled]="!online() || pending().length === 0 || flushing()"
          (buttonClick)="syncNow()"
        >
          {{ 'studentPlatform.offline.syncNow' | translate }}
        </cdf-app-button>
      </div>
    </cdf-bottom-sheet>
  `,
  styles: [
    `
      .offline-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        min-height: 32px;
        border-radius: 999px;
        background: var(--cdf-color-warning-subtle, #fff4d6);
        color: var(--cdf-color-warning-strong, #8a5a00);
        font: inherit;
        font-size: var(--cdf-font-size-xs, 12px);
        font-weight: 600;
        border: 1px solid var(--cdf-color-warning, #f5b800);
        cursor: pointer;
        white-space: nowrap;
      }
      .offline-chip[data-online='true'] {
        background: var(--cdf-color-info-subtle, #e0f2fe);
        color: var(--cdf-color-info-strong, #0c4a6e);
        border-color: var(--cdf-color-info, #38bdf8);
      }
      .offline-chip:focus-visible {
        outline: 2px solid var(--cdf-color-primary, #2563eb);
        outline-offset: 2px;
      }
      .sheet__status {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin: 0 0 12px;
      }
      .sheet__hint,
      .sheet__empty,
      .item__meta {
        color: var(--cdf-color-text-muted);
        font-size: 13px;
      }
      .sheet__warn {
        color: var(--cdf-color-warning-strong, #8a5a00);
        font-size: 14px;
      }
      .sheet__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .item__body {
        flex: 1;
        min-width: 160px;
        display: flex;
        flex-direction: column;
      }
      .item__err {
        color: var(--cdf-color-danger);
        font-size: 12px;
      }
      .sheet__foot {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class OfflineIndicator {
  private readonly network = inject(NetworkStatusService);
  private readonly sync = inject(OfflineSyncService);
  private readonly router = inject(Router);

  protected readonly online = this.network.online;
  protected readonly pending = this.sync.pending;
  protected readonly flushing = this.sync.flushing;
  protected readonly blocked = this.sync.authBlocked;
  protected readonly open = signal(false);
  protected readonly confirmDiscard = signal<string | null>(null);

  protected readonly visible = computed(
    () => !this.online() || this.pending().length > 0 || this.blocked(),
  );

  protected describeKey(e: QueuedEvent): string {
    const titled = e.lessonTitle ? 'Titled' : '';
    return e.kind === 'quiz_attempt'
      ? `studentPlatform.offline.event.quiz${titled}`
      : `studentPlatform.offline.event.lesson${titled}`;
  }

  protected async syncNow(): Promise<void> {
    await this.sync.flush({ manual: true });
  }

  protected async discard(e: QueuedEvent): Promise<void> {
    this.confirmDiscard.set(null);
    await this.sync.discard(e.clientEventId);
  }

  protected openDownloads(): void {
    this.open.set(false);
    void this.router.navigateByUrl('/downloads');
  }
}
