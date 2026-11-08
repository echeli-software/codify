import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MeClient } from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { TranslatePipe } from '@codify/i18n';
import { AppCard } from '@codify/ui-ionic';
import { AppToastService } from '../platform/app-toast.service.js';
import {
  TimeZoneSync,
  deviceTimeZone,
  supportedTimeZones,
} from './time-zone.js';

/**
 * Settings → time zone override (docs/11 §6): streak days and quest
 * resets follow this zone. Saved right away (queued offline).
 */
@Component({
  selector: 'cdf-time-zone-setting',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppCard, TranslatePipe],
  template: `
    <cdf-app-card padding="normal" data-testid="time-zone-setting">
      <h2 class="tz__title">{{ 'student.timeZone.title' | translate }}</h2>
      <p class="tz__muted">{{ 'student.timeZone.hint' | translate }}</p>
      <label class="tz__field">
        <span>{{ 'student.timeZone.label' | translate }}</span>
        <select
          data-testid="time-zone-select"
          [disabled]="saving() || current() === null"
          (change)="choose($any($event.target).value)"
        >
          @for (z of zones(); track z) {
            <option [value]="z" [selected]="z === current()">{{ z }}</option>
          }
        </select>
      </label>
      @if (device && device !== current()) {
        <button
          type="button"
          class="tz__device"
          data-testid="time-zone-device"
          [disabled]="saving()"
          (click)="choose(device)"
        >
          {{ 'student.timeZone.useDeviceNamed' | translate: { zone: device } }}
        </button>
      }
    </cdf-app-card>
  `,
  styles: [
    `
      .tz__title {
        margin: 0 0 4px;
        font-size: var(--cdf-font-size-md);
      }
      .tz__muted {
        margin: 0 0 var(--cdf-space-2);
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .tz__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--cdf-font-size-sm);
      }
      .tz__field select {
        min-height: 44px;
        max-width: 100%;
        border-radius: 8px;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        font: inherit;
        padding: 0 8px;
      }
      .tz__device {
        margin-top: var(--cdf-space-2);
        min-height: 40px;
        border: 0;
        background: none;
        color: var(--cdf-color-primary);
        font: inherit;
        font-weight: 600;
        text-decoration: underline;
        cursor: pointer;
        padding: 0;
      }
      .tz__field select:focus-visible,
      .tz__device:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class TimeZoneSetting {
  private readonly me = inject(MeClient);
  private readonly auth = inject(AuthService);
  private readonly tz = inject(TimeZoneSync);
  private readonly toast = inject(AppToastService);

  protected readonly device = deviceTimeZone();
  protected readonly current = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly zones = computed(() => {
    const all = supportedTimeZones();
    const cur = this.current();
    return cur && !all.includes(cur) ? [cur, ...all] : all;
  });

  constructor() {
    this.me
      .me()
      .then((m) => this.current.set(m.timezone))
      .catch(() => this.current.set(this.device));
  }

  protected async choose(zone: string): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId || !zone || zone === this.current()) return;
    this.saving.set(true);
    try {
      const synced = await this.tz.apply(userId, zone, 'manual');
      this.current.set(zone);
      this.toast.show({
        message: synced
          ? 'student.timeZone.saved'
          : 'student.timeZone.savedOffline',
        params: { zone },
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }
}
