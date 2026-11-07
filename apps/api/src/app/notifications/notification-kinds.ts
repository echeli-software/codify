import type { NotificationKind } from '@prisma/client';

/**
 * Notification kinds, channels and default preferences (docs/10 §3).
 * Shared by delivery (PushService / NotificationService), the preferences
 * API and the jobs so every rule reads the same table.
 */

export const NOTIFICATION_KINDS = [
  'STREAK_REMINDER',
  'DAILY_QUEST',
  'FRIEND_NUDGE',
  'LEAGUE_RESULT',
  'ITEM_DROP',
  'PROMO',
  'BILLING',
  'SYSTEM',
  'WELCOME',
  'WEEKLY_RECAP',
  'REACTIVATION',
] as const satisfies readonly NotificationKind[];

/** Kinds whose push AND email can never be turned off (critical / money). */
export const LOCKED_KINDS: ReadonlySet<NotificationKind> = new Set([
  'SYSTEM',
  'BILLING',
]);

/** Kinds that use the push channel by default. */
export const PUSH_KINDS: ReadonlySet<NotificationKind> = new Set([
  'STREAK_REMINDER',
  'DAILY_QUEST',
  'FRIEND_NUDGE',
  'LEAGUE_RESULT',
  'ITEM_DROP',
  'PROMO',
  'BILLING',
  'SYSTEM',
  'REACTIVATION',
]);

/** Kinds that use the email channel by default ("email used sparingly"). */
export const EMAIL_KINDS: ReadonlySet<NotificationKind> = new Set([
  'WELCOME',
  'BILLING',
  'WEEKLY_RECAP',
  'REACTIVATION',
  'SYSTEM',
]);

/** docs/10 §3: never more than 14 non-SYSTEM pushes per week without opt-in. */
export const WEEKLY_PUSH_CAP = 14;
/** Per-user daily cap bounds (Settings → Notifications). */
export const MAX_DAILY_PUSH_CAP = 6;
export const DEFAULT_DAILY_PUSH_CAP = 2;
/** "Fewer like this": 1 → one push of the kind per 2 days, 2 → per 7 days. */
export const FEWER_WINDOWS_MS: Record<number, number> = {
  1: 2 * 24 * 60 * 60 * 1000,
  2: 7 * 24 * 60 * 60 * 1000,
};
export const MAX_FEWER_LEVEL = 2;

export interface KindPreference {
  pushEnabled: boolean;
  emailEnabled: boolean;
  fewerLevel: number;
}

/** No row = defaults: everything on except PROMO push (opt-in). */
export function defaultPreference(kind: NotificationKind): KindPreference {
  return {
    pushEnabled: kind !== 'PROMO',
    emailEnabled: true,
    fewerLevel: 0,
  };
}

/** Effective preference for a kind (locked kinds are always on). */
export function resolvePreference(
  kind: NotificationKind,
  row: Partial<KindPreference> | null | undefined,
): KindPreference {
  const base = defaultPreference(kind);
  const merged: KindPreference = {
    pushEnabled: row?.pushEnabled ?? base.pushEnabled,
    emailEnabled: row?.emailEnabled ?? base.emailEnabled,
    fewerLevel: clampFewer(row?.fewerLevel ?? base.fewerLevel),
  };
  if (LOCKED_KINDS.has(kind)) {
    merged.pushEnabled = true;
    merged.emailEnabled = true;
  }
  return merged;
}

export function clampFewer(level: number): number {
  return Math.max(0, Math.min(MAX_FEWER_LEVEL, Math.trunc(level)));
}

export function isNotificationKind(v: unknown): v is NotificationKind {
  return (
    typeof v === 'string' &&
    (NOTIFICATION_KINDS as readonly string[]).includes(v)
  );
}

/** A quick action the inbox shows next to a notification. */
export interface NotificationAction {
  /**
   * open_today | open_daily_quest | nudge_back | open_league | open_shop |
   * open_subscription | open_notification_settings
   */
  type: string;
  /** Target id (e.g. the friend to nudge back). */
  ref?: string;
}

/** Default deep link + quick action per kind (student app routes). */
export function defaultLink(kind: NotificationKind): {
  deepLink: string;
  action: NotificationAction | null;
} {
  switch (kind) {
    case 'STREAK_REMINDER':
      return { deepLink: '/today', action: { type: 'open_today' } };
    case 'DAILY_QUEST':
      return { deepLink: '/today', action: { type: 'open_daily_quest' } };
    case 'FRIEND_NUDGE':
      return { deepLink: '/friends', action: null };
    case 'LEAGUE_RESULT':
      return { deepLink: '/league', action: { type: 'open_league' } };
    case 'ITEM_DROP':
      return { deepLink: '/shop', action: { type: 'open_shop' } };
    case 'BILLING':
      return {
        deepLink: '/subscription',
        action: { type: 'open_subscription' },
      };
    case 'PROMO':
      return {
        deepLink: '/subscription',
        action: { type: 'open_subscription' },
      };
    case 'WEEKLY_RECAP':
    case 'WELCOME':
    case 'REACTIVATION':
      return { deepLink: '/today', action: { type: 'open_today' } };
    case 'SYSTEM':
      return { deepLink: '/notifications', action: null };
  }
}

/** Only app-relative paths are accepted as deep links (no open redirects). */
export function safeDeepLink(link: string | null | undefined): string | null {
  if (typeof link !== 'string') return null;
  const trimmed = link.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.length > 512) return null;
  return trimmed;
}
