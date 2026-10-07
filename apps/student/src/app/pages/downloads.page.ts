import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppProgressBar,
  AppSelect,
  type AppSelectOption,
  AppToggle,
  BottomSheet,
  EmptyState,
  Icon,
} from '@codify/ui-ionic';
import {
  DownloadService,
  type CourseDownloadStatus,
  type DownloadRecord,
} from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { AppToastService } from '../platform/app-toast.service.js';
import { BytesPipe, formatBytes } from '../platform/bytes.pipe.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { I18nService } from '@codify/i18n';

const MB = 1024 * 1024;
const BUDGETS = [256 * MB, 512 * MB, 1024 * MB, 2048 * MB, 4096 * MB];

type PrefKey = 'wifiOnly' | 'autoUpdate' | 'autoDownloadEnrolled';

/**
 * Settings → Downloads (docs/16 §5/§10, roadmap Phase 8b): per-course size,
 * used vs budget (plus the device estimate), last updated, Update / Remove /
 * Pause / Resume, the update-available badge, Sync now, and the download
 * preferences.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppBadge,
    AppButton,
    AppCard,
    AppProgressBar,
    AppSelect,
    AppToggle,
    BottomSheet,
    EmptyState,
    Icon,
    BytesPipe,
    LocalePipe,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{
          'studentPlatform.downloads.title' | translate
        }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="page">
        <cdf-app-card padding="normal" data-testid="storage-card">
          <h2>{{ 'studentPlatform.downloads.storage' | translate }}</h2>
          <p class="muted" data-testid="storage-used">
            {{
              'studentPlatform.downloads.usedOfBudget'
                | translate
                  : { used: (used() | bytes), budget: (budget() | bytes) }
            }}
          </p>
          <cdf-app-progress-bar
            [value]="usedPct()"
            [variant]="usedPct() >= 80 ? 'warning' : 'primary'"
            [label]="
              'studentPlatform.downloads.usedPct'
                | translate: { pct: usedPct() }
            "
          />
          @if (estimate(); as est) {
            <p class="muted small" data-testid="storage-estimate">
              {{
                'studentPlatform.downloads.deviceEstimate'
                  | translate
                    : { usage: (est.usage | bytes), quota: (est.quota | bytes) }
              }}
            </p>
          }
          @if (usedPct() >= 80) {
            <p class="warn" role="status">
              {{ 'studentPlatform.downloads.lowSpace' | translate }}
            </p>
          }
          <p class="muted small">
            {{ 'studentPlatform.downloads.evictionPolicy' | translate }}
          </p>
        </cdf-app-card>

        <cdf-app-card padding="normal">
          <h2>{{ 'studentPlatform.downloads.preferences' | translate }}</h2>
          <cdf-app-toggle
            [ngModel]="prefs().wifiOnly"
            (ngModelChange)="setPref('wifiOnly', $event)"
            [label]="'studentPlatform.downloads.wifiOnly' | translate"
          />
          <cdf-app-toggle
            [ngModel]="prefs().autoUpdate"
            (ngModelChange)="setPref('autoUpdate', $event)"
            [label]="'studentPlatform.downloads.autoUpdate' | translate"
          />
          <cdf-app-toggle
            [ngModel]="prefs().autoDownloadEnrolled"
            (ngModelChange)="setPref('autoDownloadEnrolled', $event)"
            [label]="
              'studentPlatform.downloads.autoDownloadEnrolled' | translate
            "
          />
          <div class="budget">
            <span id="budget-label">{{
              'studentPlatform.downloads.budget' | translate
            }}</span>
            <cdf-app-select
              [options]="budgetOptions()"
              [ngModel]="budget()"
              (ngModelChange)="setBudget($event)"
              [ariaLabel]="'studentPlatform.downloads.budget' | translate"
            />
          </div>
          @if (waitingForWifi()) {
            <p class="muted small" role="status">
              {{ 'studentPlatform.downloads.waitingForWifiHint' | translate }}
            </p>
          }
        </cdf-app-card>

        <cdf-app-card padding="normal">
          <h2>{{ 'studentPlatform.downloads.sync' | translate }}</h2>
          <p class="muted">
            {{
              'studentPlatform.downloads.pending'
                | translate: { count: sync.pendingCount() }
            }}
          </p>
          @if (sync.authBlocked()) {
            <p class="warn" role="status">
              {{ 'studentPlatform.sync.signInAgain' | translate }}
            </p>
          }
          <div class="actions">
            <cdf-app-button
              kind="secondary"
              size="sm"
              [loading]="sync.flushing()"
              [disabled]="!online()"
              (buttonClick)="syncNow()"
              data-testid="sync-now-btn"
            >
              <cdf-icon name="refresh" size="sm" />
              {{ 'studentPlatform.offline.syncNow' | translate }}
            </cdf-app-button>
            <cdf-app-button
              kind="ghost"
              size="sm"
              [loading]="checking()"
              [disabled]="!online() || downloads().length === 0"
              (buttonClick)="checkUpdates()"
              data-testid="check-updates-btn"
            >
              {{ 'studentPlatform.downloads.checkUpdates' | translate }}
            </cdf-app-button>
          </div>
        </cdf-app-card>

        <div class="head">
          <h2>
            {{
              'studentPlatform.downloads.courses'
                | translate: { count: downloads().length }
            }}
          </h2>
          @if (downloads().length > 0) {
            <cdf-app-button
              kind="ghost"
              size="sm"
              (buttonClick)="confirmTarget.set('all')"
              data-testid="remove-all-btn"
            >
              {{ 'studentPlatform.downloads.removeAll' | translate }}
            </cdf-app-button>
          }
        </div>

        @if (downloads().length === 0) {
          <cdf-empty-state
            icon="download"
            [title]="'studentPlatform.downloads.emptyTitle' | translate"
            [description]="'studentPlatform.downloads.emptyBody' | translate"
          />
        } @else {
          <ul class="list" data-testid="downloads-list">
            @for (d of downloads(); track d.courseId) {
              @let st = statusOf(d.courseId);
              <li>
                <cdf-app-card
                  padding="normal"
                  [attr.data-course-id]="d.courseId"
                  [attr.data-state]="st.state"
                >
                  <div class="row">
                    <div class="row__info">
                      <a
                        class="row__title"
                        [routerLink]="['/courses', d.courseSlug]"
                        >{{ d.title }}</a
                      >
                      <span class="muted small">
                        {{
                          'studentPlatform.downloads.lessonsCount'
                            | translate
                              : {
                                  count: d.lessonCount,
                                  total: d.totalLessons ?? d.lessonCount,
                                }
                        }}
                        · {{ d.totalBytes | bytes }} ·
                        {{
                          'studentPlatform.downloads.updatedAgo'
                            | translate
                              : {
                                  when:
                                    (d.updatedAt ?? d.downloadedAt
                                    | locale: 'relative'),
                                }
                        }}
                      </span>
                    </div>
                    <div class="row__badges">
                      @switch (st.state) {
                        @case ('complete') {
                          <cdf-app-badge variant="success" [subtle]="true">{{
                            'studentPlatform.downloads.state.complete'
                              | translate
                          }}</cdf-app-badge>
                        }
                        @case ('partial') {
                          <cdf-app-badge variant="neutral" [subtle]="true">{{
                            'studentPlatform.downloads.state.partial'
                              | translate
                          }}</cdf-app-badge>
                        }
                        @case ('downloading') {
                          <cdf-app-badge variant="info" [subtle]="true">{{
                            'studentPlatform.downloads.state.downloading'
                              | translate: { pct: st.pct }
                          }}</cdf-app-badge>
                        }
                        @case ('waitingForWifi') {
                          <cdf-app-badge variant="warning" [subtle]="true">{{
                            'studentPlatform.downloads.state.waitingForWifi'
                              | translate
                          }}</cdf-app-badge>
                        }
                        @case ('needsSpace') {
                          <cdf-app-badge variant="warning" [subtle]="true">{{
                            'studentPlatform.downloads.state.needsSpace'
                              | translate
                          }}</cdf-app-badge>
                        }
                        @case ('error') {
                          <cdf-app-badge variant="danger" [subtle]="true">{{
                            'studentPlatform.downloads.state.error' | translate
                          }}</cdf-app-badge>
                        }
                        @default {
                          <cdf-app-badge variant="neutral" [subtle]="true">{{
                            'studentPlatform.downloads.state.paused' | translate
                          }}</cdf-app-badge>
                        }
                      }
                      @if (st.updateAvailable) {
                        <cdf-app-badge
                          variant="info"
                          data-testid="update-available"
                          >{{
                            'studentPlatform.downloads.updateAvailable'
                              | translate
                          }}</cdf-app-badge
                        >
                      }
                    </div>
                  </div>
                  @if (
                    st.state === 'downloading' ||
                    st.state === 'paused' ||
                    st.state === 'waitingForWifi'
                  ) {
                    @if (st.total > 0) {
                      <cdf-app-progress-bar
                        size="sm"
                        [value]="st.pct"
                        [label]="
                          'studentPlatform.downloads.progressLabel'
                            | translate
                              : { current: st.current, total: st.total }
                        "
                      />
                    }
                  }
                  <div class="actions">
                    @if (st.updateAvailable && st.state !== 'downloading') {
                      <cdf-app-button
                        kind="primary"
                        size="sm"
                        [disabled]="!online()"
                        (buttonClick)="update(d)"
                        data-testid="update-course-btn"
                      >
                        {{ 'studentPlatform.downloads.update' | translate }}
                      </cdf-app-button>
                    }
                    @if (st.state === 'downloading') {
                      <cdf-app-button
                        kind="ghost"
                        size="sm"
                        (buttonClick)="pause(d)"
                        >{{
                          'studentPlatform.downloads.pause' | translate
                        }}</cdf-app-button
                      >
                    } @else if (
                      st.state === 'paused' ||
                      st.state === 'partial' ||
                      st.state === 'error' ||
                      st.state === 'needsSpace'
                    ) {
                      <cdf-app-button
                        kind="ghost"
                        size="sm"
                        [disabled]="!online()"
                        (buttonClick)="resume(d)"
                        >{{
                          'studentPlatform.downloads.resume' | translate
                        }}</cdf-app-button
                      >
                    }
                    <cdf-app-button
                      kind="ghost"
                      size="sm"
                      (buttonClick)="confirmTarget.set(d)"
                      data-testid="remove-course-btn"
                    >
                      {{ 'common.remove' | translate }}
                    </cdf-app-button>
                  </div>
                </cdf-app-card>
              </li>
            }
          </ul>
        }
      </div>

      <cdf-bottom-sheet
        [open]="confirmTarget() !== null"
        (openChange)="!$event && confirmTarget.set(null)"
        [title]="'studentPlatform.downloads.removeTitle' | translate"
      >
        <p>
          @if (confirmTarget() === 'all') {
            {{
              'studentPlatform.downloads.removeAllBody'
                | translate: { size: (used() | bytes) }
            }}
          } @else if (confirmCourse(); as c) {
            {{
              'studentPlatform.downloads.removeBody'
                | translate: { title: c.title, size: (c.totalBytes | bytes) }
            }}
          }
        </p>
        <div sheetFooter class="actions actions--end">
          <cdf-app-button
            kind="ghost"
            (buttonClick)="confirmTarget.set(null)"
            >{{ 'common.cancel' | translate }}</cdf-app-button
          >
          <cdf-app-button
            kind="danger"
            (buttonClick)="confirmRemove()"
            data-testid="confirm-remove-btn"
            >{{ 'common.remove' | translate }}</cdf-app-button
          >
        </div>
      </cdf-bottom-sheet>
    </ion-content>
  `,
  styles: [
    `
      .page {
        max-width: 760px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      h2 {
        margin: 0 0 8px;
        font-size: var(--cdf-font-size-md, 16px);
      }
      .muted {
        color: var(--cdf-color-text-muted);
        font-size: 14px;
        margin: 0 0 8px;
      }
      .small {
        font-size: 12px;
      }
      .warn {
        color: var(--cdf-color-warning-strong, #8a5a00);
        font-size: 13px;
        margin: 8px 0 0;
      }
      cdf-app-toggle {
        display: flex;
        width: 100%;
        min-height: 44px;
      }
      :host ::ng-deep cdf-app-toggle ion-toggle {
        width: 100%;
      }
      :host ::ng-deep cdf-app-toggle ion-toggle::part(label) {
        white-space: normal;
        flex: 1;
      }
      .budget {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .head h2 {
        margin: 0;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        flex-wrap: wrap;
      }
      .row__info {
        flex: 1;
        min-width: 180px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .row__title {
        font-weight: 600;
        color: inherit;
      }
      .row__badges {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .actions--end {
        justify-content: flex-end;
      }
    `,
  ],
})
export class DownloadsPage {
  private readonly dl = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);
  protected readonly sync = inject(OfflineSyncService);

  protected readonly downloads = this.dl.downloads;
  protected readonly prefs = this.dl.prefs;
  protected readonly estimate = this.dl.storageEstimate;
  protected readonly online = this.network.online;
  protected readonly used = this.dl.totalBytes;
  protected readonly budget = computed(() => this.prefs().budgetBytes);
  protected readonly usedPct = computed(() =>
    Math.min(100, Math.round((this.used() / Math.max(1, this.budget())) * 100)),
  );
  protected readonly budgetOptions = computed<AppSelectOption<number>[]>(() => {
    const locale = this.i18n.currentLocale();
    const values = BUDGETS.includes(this.budget())
      ? BUDGETS
      : [...BUDGETS, this.budget()].sort((a, b) => a - b);
    return values.map((v) => ({ value: v, label: formatBytes(v, locale) }));
  });
  protected readonly waitingForWifi = computed(() =>
    this.downloads().some(
      (d) => this.dl.status(d.courseId)().state === 'waitingForWifi',
    ),
  );
  protected readonly checking = signal(false);
  protected readonly confirmTarget = signal<DownloadRecord | 'all' | null>(
    null,
  );
  protected readonly confirmCourse = computed(() => {
    const t = this.confirmTarget();
    return t && t !== 'all' ? t : null;
  });

  constructor() {
    void this.dl.hydrate().then(() => this.dl.refreshEstimate());
    this.telemetry.track('downloads_viewed');
  }

  protected statusOf(courseId: string): CourseDownloadStatus {
    return this.dl.status(courseId)();
  }

  protected setPref(key: PrefKey, value: boolean): void {
    this.dl.setPrefs({ [key]: value });
  }

  protected setBudget(bytes: number): void {
    this.dl.setPrefs({ budgetBytes: Number(bytes) });
  }

  protected async update(d: DownloadRecord): Promise<void> {
    try {
      await this.dl.updateCourse(d.courseId);
      this.toast.show({
        message: 'studentPlatform.downloads.updated',
        params: { title: d.title },
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected pause(d: DownloadRecord): void {
    this.dl.pause(d.courseId);
  }

  protected async resume(d: DownloadRecord): Promise<void> {
    try {
      await this.dl.resume(d.courseId);
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async confirmRemove(): Promise<void> {
    const target = this.confirmTarget();
    this.confirmTarget.set(null);
    if (!target) return;
    try {
      if (target === 'all') {
        await this.dl.removeAll();
        this.telemetry.track('download_removed_all');
      } else {
        await this.dl.removeCourse(target.courseId);
        this.telemetry.track('download_removed', {
          courseId: target.courseId,
          bytes: target.totalBytes,
        });
      }
      this.toast.show({
        message: 'studentPlatform.downloads.removed',
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async syncNow(): Promise<void> {
    const res = await this.sync.flush({ manual: true });
    this.toast.show({
      message:
        res.remaining === 0
          ? 'studentPlatform.sync.allSynced'
          : 'studentPlatform.sync.someRemaining',
      params: { count: res.remaining },
      kind: res.remaining === 0 ? 'success' : 'warning',
    });
  }

  protected async checkUpdates(): Promise<void> {
    this.checking.set(true);
    try {
      await this.dl.checkForUpdates({ force: true });
      const n = this.downloads().filter((d) => d.updateAvailable).length;
      this.toast.show({
        message:
          n > 0
            ? 'studentPlatform.downloads.updatesFound'
            : 'studentPlatform.downloads.upToDate',
        params: { count: n },
        kind: 'info',
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.checking.set(false);
    }
  }
}
