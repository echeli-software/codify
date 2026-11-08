import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

/** docs/10 §3 notification kinds (+ WELCOME / WEEKLY_RECAP / REACTIVATION). */
export type NotificationKind =
  | 'STREAK_REMINDER'
  | 'DAILY_QUEST'
  | 'FRIEND_NUDGE'
  | 'LEAGUE_RESULT'
  | 'ITEM_DROP'
  | 'PROMO'
  | 'BILLING'
  | 'SYSTEM'
  | 'WELCOME'
  | 'WEEKLY_RECAP'
  | 'REACTIVATION';

/** Inbox quick action, e.g. `{ type: 'nudge_back', ref: '<friend id>' }`. */
export interface NotificationAction {
  /**
   * open_today | open_daily_quest | nudge_back | open_league | open_shop |
   * open_subscription | open_notification_settings
   */
  type: string;
  ref?: string;
}

/** An inbox entry (IN_APP notification), copy already in the user's locale. */
export interface InboxNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** App route (`/league`, `/subscription?offer=winback`). */
  deepLink: string | null;
  action: NotificationAction | null;
  createdAt: string;
  readAt: string | null;
}

export interface InboxPage {
  items: InboxNotification[];
  /** Pass as `cursor` for the next (older) page; null at the end. */
  nextCursor: string | null;
}

export interface KindPreference {
  kind: NotificationKind;
  pushEnabled: boolean;
  emailEnabled: boolean;
  /** "Fewer like this": 0 normal, 1 fewer (≤ 1 push / 2 days), 2 much fewer (≤ 1 / 7 days). */
  fewerLevel: number;
  /** SYSTEM / BILLING: push + email can't be turned off. */
  locked: boolean;
  /** Channels this kind uses at all. */
  channels: { push: boolean; email: boolean };
}

export interface NotificationPreferences {
  /** Null = default (2/day). 0 = no push except critical ones. Max 6. */
  pushDailyCap: number | null;
  /** Opt in to more than 14 pushes per week. */
  pushWeeklyOptIn: boolean;
  /** Daily-quest reminder time, user-local minutes; null = automatic. */
  reminderMinute: number | null;
  kinds: KindPreference[];
}

export interface UpdateNotificationPreferencesBody {
  pushDailyCap?: number | null;
  pushWeeklyOptIn?: boolean;
  reminderMinute?: number | null;
  kinds?: {
    kind: NotificationKind;
    pushEnabled?: boolean;
    emailEnabled?: boolean;
    fewerLevel?: number;
  }[];
}

/**
 * Typed client for the notification inbox + preferences (docs/05
 * Notifications, docs/10 §3). Quiet hours stay on `MeClient.update`
 * (`quietHoursStart` / `quietHoursEnd`).
 * Errors: 404 for a notification that isn't yours; 400
 * `NOTIFICATION_KIND_LOCKED` when turning off / reducing SYSTEM or BILLING.
 */
/** GET /me/promo-prompt — the one-time "bonus event alerts" question. */
export interface PromoPromptState {
  /** Ask now (known adult, ≥ 1 completed lesson, never asked). */
  show: boolean;
  promptedAt: string | null;
}

/** POST /me/promo-prompt answer. */
export interface PromoPromptAnswer {
  promptedAt: string;
  push: boolean;
  email: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return `${this.config.baseUrl}/me`;
  }

  /** GET /me/notifications — newest first. */
  list(
    opts: { cursor?: string | null; limit?: number } = {},
  ): Promise<InboxPage> {
    let params = new HttpParams();
    if (opts.cursor) params = params.set('cursor', opts.cursor);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return firstValueFrom(
      this.http.get<InboxPage>(`${this.base}/notifications`, { params }),
    );
  }

  unreadCount(): Promise<{ count: number }> {
    return firstValueFrom(
      this.http.get<{ count: number }>(
        `${this.base}/notifications/unread-count`,
      ),
    );
  }

  markRead(id: string): Promise<InboxNotification> {
    return firstValueFrom(
      this.http.post<InboxNotification>(
        `${this.base}/notifications/${encodeURIComponent(id)}/read`,
        {},
      ),
    );
  }

  markAllRead(): Promise<{ updated: number }> {
    return firstValueFrom(
      this.http.post<{ updated: number }>(
        `${this.base}/notifications/read-all`,
        {},
      ),
    );
  }

  /** "Fewer like this" for the notification's kind (max level 2). */
  fewer(id: string): Promise<{ kind: NotificationKind; fewerLevel: number }> {
    return firstValueFrom(
      this.http.post<{ kind: NotificationKind; fewerLevel: number }>(
        `${this.base}/notifications/${encodeURIComponent(id)}/fewer`,
        {},
      ),
    );
  }

  preferences(): Promise<NotificationPreferences> {
    return firstValueFrom(
      this.http.get<NotificationPreferences>(
        `${this.base}/notification-preferences`,
      ),
    );
  }

  updatePreferences(
    body: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferences> {
    return firstValueFrom(
      this.http.put<NotificationPreferences>(
        `${this.base}/notification-preferences`,
        body,
      ),
    );
  }

  /** GET /me/promo-prompt — whether to show the promo alerts card. */
  promoPrompt(): Promise<PromoPromptState> {
    return firstValueFrom(
      this.http.get<PromoPromptState>(`${this.base}/promo-prompt`),
    );
  }

  /**
   * POST /me/promo-prompt — answer once. `push` turns PROMO push on, `email`
   * (its own tick box) is the marketing-email consent. 409
   * `PROMO_PROMPT_ANSWERED` after the first answer; 403
   * `PROMO_PROMPT_NOT_ALLOWED` for minors / no date of birth.
   */
  answerPromoPrompt(answer: {
    push: boolean;
    email: boolean;
  }): Promise<PromoPromptAnswer> {
    return firstValueFrom(
      this.http.post<PromoPromptAnswer>(`${this.base}/promo-prompt`, answer),
    );
  }
}
