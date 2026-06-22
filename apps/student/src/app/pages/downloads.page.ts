import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSelect,
  type AppSelectOption,
  AppToggle,
  EmptyState,
  Icon,
} from '@codify/ui-ionic';
import { DownloadService } from '../offline/download.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';

const MB = 1024 * 1024;
const BUDGET_OPTIONS: AppSelectOption<number>[] = [
  { value: 256 * MB, label: '256 MB' },
  { value: 512 * MB, label: '512 MB' },
  { value: 1024 * MB, label: '1 GB' },
  { value: 2048 * MB, label: '2 GB' },
];

/**
 * Settings → Downloads (docs/16-offline §5/§10). Manage downloaded courses,
 * storage budget + LRU policy, sync, and download preferences.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonContent, AppBadge, AppButton, AppCard, AppSelect, AppToggle, EmptyState, Icon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Downloads</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <!-- Storage usage -->
      <cdf-app-card padding="normal" data-testid="storage-card">
        <h3>Storage</h3>
        <p class="muted" data-testid="storage-used">{{ formatBytes(used()) }} of {{ formatBytes(budget()) }} used</p>
        <div class="bar"><span class="bar__fill" [style.width.%]="usedPct()"></span></div>
        @if (usedPct() >= 80) {
        <p class="warn">You're running low — remove a course or raise the budget to free up space.</p>
        }
      </cdf-app-card>

      <!-- Preferences -->
      <cdf-app-card padding="normal">
        <h3>Preferences</h3>
        <cdf-app-toggle [ngModel]="prefs().wifiOnly" (ngModelChange)="setPref('wifiOnly', $event)" label="Wi-Fi only" />
        <cdf-app-toggle [ngModel]="prefs().autoUpdate" (ngModelChange)="setPref('autoUpdate', $event)" label="Auto-update on Wi-Fi" />
        <div class="budget">
          <span>Storage budget</span>
          <cdf-app-select [options]="budgetOptions" [ngModel]="budget()" (ngModelChange)="setBudget($event)" />
        </div>
      </cdf-app-card>

      <!-- Sync -->
      <cdf-app-card padding="normal">
        <h3>Sync</h3>
        <p class="muted">{{ sync.pendingCount() }} pending change(s) to sync.</p>
        <cdf-app-button kind="secondary" size="sm" [loading]="sync.flushing()" (buttonClick)="syncNow()" data-testid="sync-now-btn">
          <cdf-icon name="refresh" size="sm" /> Sync now
        </cdf-app-button>
      </cdf-app-card>

      <!-- Downloaded courses -->
      <div class="head">
        <h3>Downloaded courses ({{ downloads().length }})</h3>
        @if (downloads().length > 0) {
        <cdf-app-button kind="ghost" size="sm" (buttonClick)="removeAll()" data-testid="remove-all-btn">Remove all</cdf-app-button>
        }
      </div>

      @if (downloads().length === 0) {
      <cdf-empty-state icon="download" title="No downloads yet" description="Download a course from its detail page to read it offline." />
      } @else {
      <div class="list" data-testid="downloads-list">
        @for (d of downloads(); track d.courseId) {
        <cdf-app-card padding="normal" class="row" [attr.data-course-id]="d.courseId">
          <div class="row__info">
            <strong>{{ d.title }}</strong>
            <span class="muted">{{ d.lessonCount }} lessons · {{ formatBytes(d.totalBytes) }} · {{ formatDate(d.downloadedAt) }}</span>
          </div>
          <cdf-app-badge variant="success" [subtle]="true">Offline</cdf-app-badge>
          <cdf-app-button kind="ghost" size="sm" (buttonClick)="remove(d.courseId)" data-testid="remove-course-btn">Remove</cdf-app-button>
        </cdf-app-card>
        }
      </div>
      }
    </ion-content>
  `,
  styles: [
    `
      h3 { margin: 0 0 var(--cdf-space-2); font-size: var(--cdf-font-size-md); }
      cdf-app-card { display: block; margin-bottom: var(--cdf-space-3); }
      .muted { color: var(--cdf-color-text-muted); font-size: 13px; margin: 0 0 var(--cdf-space-2); }
      .warn { color: var(--cdf-color-warning, #c87000); font-size: 13px; margin: var(--cdf-space-2) 0 0; }
      .bar { height: 8px; border-radius: 4px; background: var(--cdf-color-surface-2, #e6e9f0); overflow: hidden; }
      .bar__fill { display: block; height: 100%; background: var(--cdf-color-primary, #5b8def); }
      .budget { display: flex; align-items: center; justify-content: space-between; gap: var(--cdf-space-2); margin-top: var(--cdf-space-2); }
      .head { display: flex; align-items: center; justify-content: space-between; }
      .list { display: flex; flex-direction: column; gap: var(--cdf-space-2); }
      .row { display: flex; align-items: center; gap: var(--cdf-space-2); }
      .row__info { flex: 1; display: flex; flex-direction: column; }
    `,
  ],
})
export class DownloadsPage {
  private readonly dl = inject(DownloadService);
  protected readonly sync = inject(OfflineSyncService);

  protected readonly downloads = this.dl.downloads;
  protected readonly prefs = this.dl.prefs;
  protected readonly budgetOptions = BUDGET_OPTIONS;
  protected readonly used = this.dl.totalBytes;
  protected readonly budget = computed(() => this.prefs().budgetBytes);
  protected readonly usedPct = computed(() => Math.min(100, Math.round((this.used() / Math.max(1, this.budget())) * 100)));

  constructor() {
    void this.dl.hydrate();
  }

  protected setPref(key: 'wifiOnly' | 'autoUpdate', value: boolean): void {
    this.dl.setPrefs({ [key]: value });
  }
  protected setBudget(bytes: number): void {
    this.dl.setPrefs({ budgetBytes: Number(bytes) });
  }
  protected async remove(courseId: string): Promise<void> {
    await this.dl.removeCourse(courseId);
  }
  protected async removeAll(): Promise<void> {
    await this.dl.removeAll();
  }
  protected async syncNow(): Promise<void> {
    await this.sync.flush();
  }

  protected formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < MB) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * MB) return `${(b / MB).toFixed(1)} MB`;
    return `${(b / (1024 * MB)).toFixed(2)} GB`;
  }
  protected formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
}
