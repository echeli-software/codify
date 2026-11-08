import { Injectable, inject } from '@angular/core';
import { MeClient } from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { AppToastService } from '../platform/app-toast.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/** Server default until detection runs (docs/11 §6). */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const KEY = 'codify.tz.';

/** What this device knows about the user's zone choice. */
export interface TimeZoneRecord {
  /** Zone last confirmed for the account. */
  zone: string;
  /** `manual` = picked in Settings (never overridden silently). */
  source: 'auto' | 'manual';
  /** Device zone the user said "no" to (asked once per zone). */
  declined?: string;
}

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function readTzRecord(userId: string): TimeZoneRecord | null {
  try {
    const raw = localStorage.getItem(KEY + userId);
    return raw ? (JSON.parse(raw) as TimeZoneRecord) : null;
  } catch {
    return null;
  }
}

export function writeTzRecord(userId: string, r: TimeZoneRecord): void {
  try {
    localStorage.setItem(KEY + userId, JSON.stringify(r));
  } catch {
    /* best-effort */
  }
}

export type TzDecision = 'none' | 'auto' | 'ask';

/**
 * docs/11 §6: set `User.timezone` from the device on first sign-in, and
 * when the device moves — but never silently override a zone the user
 * chose: then ask.
 *
 *   none  server already matches the device, or the user declined this zone
 *   auto  account still on the default / on a zone this device set itself
 *   ask   the account has a different, possibly user-chosen zone
 */
export function decideTimeZone(
  serverZone: string,
  device: string | null,
  record: TimeZoneRecord | null,
): TzDecision {
  if (!device || device === serverZone) return 'none';
  if (record?.declined === device) return 'none';
  if (record?.source === 'manual') return 'ask';
  if (!record && serverZone === DEFAULT_TIME_ZONE) return 'auto';
  if (record?.source === 'auto' && record.zone === serverZone) return 'auto';
  return 'ask';
}

/** IANA zones the runtime knows (for the Settings picker). */
export function supportedTimeZones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (k: string) => string[];
  };
  try {
    const list = intl.supportedValuesOf?.('timeZone');
    if (list?.length) return list;
  } catch {
    /* older runtimes */
  }
  return [DEFAULT_TIME_ZONE, 'America/New_York', 'Europe/Lisbon', 'UTC'];
}

/** Detects / syncs the account time zone once per session (FIX-9). */
@Injectable({ providedIn: 'root' })
export class TimeZoneSync {
  private readonly me = inject(MeClient);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(OfflineSyncService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private checkedFor: string | null = null;

  async check(): Promise<TzDecision> {
    const userId = this.auth.user()?.id;
    if (!userId || this.checkedFor === userId) return 'none';
    this.checkedFor = userId;
    let serverZone: string;
    try {
      serverZone = (await this.me.me()).timezone;
    } catch {
      this.checkedFor = null; // retry next time (offline)
      return 'none';
    }
    const device = deviceTimeZone();
    const record = readTzRecord(userId);
    const decision = decideTimeZone(serverZone, device, record);
    if (decision === 'none') {
      if (device === serverZone)
        writeTzRecord(userId, {
          zone: serverZone,
          source: record?.source ?? 'auto',
          ...(record?.declined ? { declined: record.declined } : {}),
        });
      return decision;
    }
    if (decision === 'auto' && device) {
      await this.apply(userId, device, 'auto');
      this.telemetry.track('timezone_detected', { changed: true });
      return decision;
    }
    // Ask once per device zone; "no" (dismiss) keeps the account's zone.
    writeTzRecord(userId, {
      zone: serverZone,
      source: record?.source ?? 'manual',
      declined: device ?? undefined,
    });
    this.toast.show({
      message: 'student.timeZone.askUpdate',
      params: { device, current: serverZone },
      kind: 'info',
      durationMs: 0,
      action: {
        label: 'student.timeZone.useDevice',
        handler: () => {
          if (device) void this.apply(userId, device, 'auto');
        },
      },
    });
    return decision;
  }

  /** Save a zone (Settings or the prompt); queued when offline. */
  async apply(
    userId: string,
    zone: string,
    source: TimeZoneRecord['source'],
  ): Promise<boolean> {
    writeTzRecord(userId, { zone, source });
    return this.sync.updatePreferences({ timezone: zone });
  }
}
