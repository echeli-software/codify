import type { InboxNotification, NotificationKind } from '@codify/api-client';
import type { IconName } from '@codify/ui-ionic';

/** Icon per notification kind (inbox list + settings). */
export const KIND_ICONS: Record<NotificationKind, IconName> = {
  STREAK_REMINDER: 'flame',
  DAILY_QUEST: 'trophy',
  FRIEND_NUDGE: 'chat',
  LEAGUE_RESULT: 'podium',
  ITEM_DROP: 'gift',
  PROMO: 'diamond',
  BILLING: 'diamond',
  SYSTEM: 'info-circle',
  WELCOME: 'sparkles',
  WEEKLY_RECAP: 'star',
  REACTIVATION: 'rocket',
};

/** Kinds whose push/email can't be turned off (mirrors the API). */
export const LOCKED_KINDS: ReadonlySet<NotificationKind> = new Set([
  'SYSTEM',
  'BILLING',
]);

export type QuickAction =
  | { kind: 'navigate'; labelKey: string; route: string }
  | { kind: 'nudge'; labelKey: string; friendId: string };

const ACTION_ROUTES: Record<string, string> = {
  open_today: '/today',
  open_daily_quest: '/today',
  open_league: '/league',
  open_shop: '/shop',
  open_subscription: '/subscription',
  open_notification_settings: '/settings/notifications',
};

/** Only in-app paths are followed (never an absolute / protocol URL). */
export function safeRoute(link: string | null | undefined): string | null {
  if (typeof link !== 'string') return null;
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  return link;
}

/**
 * The per-notification quick action (docs/05 "Open daily quest", "Send
 * back nudge"…). A known `action.type` wins; the deep link of the
 * notification is the navigation target when it is more specific (e.g.
 * `/subscription?offer=winback`).
 */
export function quickAction(n: InboxNotification): QuickAction | null {
  const a = n.action;
  if (!a) return null;
  if (a.type === 'nudge_back') {
    return a.ref
      ? {
          kind: 'nudge',
          labelKey: 'student.notifications.actions.nudge_back',
          friendId: a.ref,
        }
      : null;
  }
  const base = ACTION_ROUTES[a.type];
  if (!base) return null;
  const link = safeRoute(n.deepLink);
  const route = link && link.split('?')[0] === base ? link : base;
  return {
    kind: 'navigate',
    labelKey: `student.notifications.actions.${a.type}`,
    route,
  };
}

/** Where tapping the notification itself goes. */
export function openRoute(n: InboxNotification): string | null {
  return safeRoute(n.deepLink);
}
