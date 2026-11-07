import type {
  KindPreference,
  MeResponse,
  NotificationPreferences,
  UpdateMeBody,
  UpdateNotificationPreferencesBody,
} from '@codify/api-client';

export const DEFAULT_QUIET_START = 22 * 60;
export const DEFAULT_QUIET_END = 8 * 60;
export const DEFAULT_REMINDER = 20 * 60;
export const MAX_DAILY_CAP = 6;

/** Editable state of Settings → Notifications. */
export interface PrefsForm {
  kinds: KindPreference[];
  /** 'default' | '0'..'6' (select value). */
  dailyCap: string;
  weeklyOptIn: boolean;
  reminderMode: 'auto' | 'custom';
  /** 'HH:MM' (only used when reminderMode is custom). */
  reminderTime: string;
  quietStart: string;
  quietEnd: string;
}

export function minutesToTime(m: number): string {
  const v = ((Math.trunc(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 'HH:MM' → minutes from midnight; null when not a valid time. */
export function timeToMinutes(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function toForm(
  prefs: NotificationPreferences,
  me: Pick<MeResponse, 'quietHoursStart' | 'quietHoursEnd'>,
): PrefsForm {
  return {
    kinds: prefs.kinds.map((k) => ({ ...k, channels: { ...k.channels } })),
    dailyCap:
      prefs.pushDailyCap === null ? 'default' : String(prefs.pushDailyCap),
    weeklyOptIn: prefs.pushWeeklyOptIn,
    reminderMode: prefs.reminderMinute === null ? 'auto' : 'custom',
    reminderTime: minutesToTime(prefs.reminderMinute ?? DEFAULT_REMINDER),
    quietStart: minutesToTime(me.quietHoursStart ?? DEFAULT_QUIET_START),
    quietEnd: minutesToTime(me.quietHoursEnd ?? DEFAULT_QUIET_END),
  };
}

/** Deep copy (kinds are edited immutably, but keep the two forms apart). */
export function cloneForm(f: PrefsForm): PrefsForm {
  return {
    ...f,
    kinds: f.kinds.map((k) => ({ ...k, channels: { ...k.channels } })),
  };
}

export interface PrefsChanges {
  prefs: UpdateNotificationPreferencesBody | null;
  me: Pick<UpdateMeBody, 'quietHoursStart' | 'quietHoursEnd'> | null;
  /** Kinds whose push/email toggles changed (telemetry). */
  changedKinds: { kind: string; channel: 'push' | 'email'; enabled: boolean }[];
  /** Something is invalid (e.g. an empty time) — don't save. */
  invalid: boolean;
}

/**
 * What to send for the edits between `original` and `form`: only changed
 * fields, so an untouched setting keeps its server default (null) rather
 * than being pinned to the value it happened to resolve to.
 */
export function diffForm(original: PrefsForm, form: PrefsForm): PrefsChanges {
  const prefs: UpdateNotificationPreferencesBody = {};
  const changedKinds: PrefsChanges['changedKinds'] = [];
  let invalid = false;

  if (form.dailyCap !== original.dailyCap) {
    prefs.pushDailyCap =
      form.dailyCap === 'default' ? null : Number(form.dailyCap);
  }
  if (form.weeklyOptIn !== original.weeklyOptIn) {
    prefs.pushWeeklyOptIn = form.weeklyOptIn;
  }
  const reminder =
    form.reminderMode === 'auto' ? null : timeToMinutes(form.reminderTime);
  const originalReminder =
    original.reminderMode === 'auto'
      ? null
      : timeToMinutes(original.reminderTime);
  if (form.reminderMode === 'custom' && reminder === null) invalid = true;
  else if (reminder !== originalReminder) prefs.reminderMinute = reminder;

  const kinds: NonNullable<UpdateNotificationPreferencesBody['kinds']> = [];
  for (const k of form.kinds) {
    const was = original.kinds.find((o) => o.kind === k.kind);
    if (!was || k.locked) continue;
    const patch: (typeof kinds)[number] = { kind: k.kind };
    if (k.pushEnabled !== was.pushEnabled) {
      patch.pushEnabled = k.pushEnabled;
      changedKinds.push({
        kind: k.kind,
        channel: 'push',
        enabled: k.pushEnabled,
      });
    }
    if (k.emailEnabled !== was.emailEnabled) {
      patch.emailEnabled = k.emailEnabled;
      changedKinds.push({
        kind: k.kind,
        channel: 'email',
        enabled: k.emailEnabled,
      });
    }
    if (k.fewerLevel !== was.fewerLevel) patch.fewerLevel = k.fewerLevel;
    if (Object.keys(patch).length > 1) kinds.push(patch);
  }
  if (kinds.length > 0) prefs.kinds = kinds;

  let me: PrefsChanges['me'] = null;
  const qs = timeToMinutes(form.quietStart);
  const qe = timeToMinutes(form.quietEnd);
  if (qs === null || qe === null) invalid = true;
  else if (
    form.quietStart !== original.quietStart ||
    form.quietEnd !== original.quietEnd
  ) {
    me = { quietHoursStart: qs, quietHoursEnd: qe };
  }

  return {
    prefs: Object.keys(prefs).length > 0 ? prefs : null,
    me,
    changedKinds,
    invalid,
  };
}
