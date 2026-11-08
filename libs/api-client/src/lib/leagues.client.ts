import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { AvatarResponse } from './items.client.js';

export interface LeagueMember {
  userId: string;
  displayName: string;
  weeklyXp: number;
  level: number;
  rank: number;
  isMe: boolean;
  /** Avatar config + equipped items (same shape as GET /me/avatar). */
  avatar: AvatarResponse;
}

export interface CurrentLeague {
  tier: string;
  weekStart: string;
  resetAt: string;
  promoteCount: number;
  demoteCount: number;
  cohortSize: number;
  myRank: number;
  myWeeklyXp: number;
  members: LeagueMember[];
}

export type LeagueTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND';

/** GET /league/last-week — the caller's result for the last rolled-over week. */
export interface LastWeekResult {
  tier: LeagueTier;
  newTier: LeagueTier;
  finalRank: number;
  cohortSize: number;
  promoted: boolean;
  demoted: boolean;
  xpReward: number;
  coinReward: number;
  freezeAwarded: boolean;
  /** UTC Monday 00:00 of that week. */
  weekStart: string;
}

export interface RolloverSummary {
  weekStart: string;
  leaguesProcessed: number;
  membersRewarded: number;
  promotions: number;
  badgesAwarded: number;
  pushesSent: number;
}

export interface FriendInvite {
  code: string;
  /** Share link (`<student app>/r/<code>`) — also the referral link. */
  url: string;
}

export interface AcceptInviteResult {
  status: 'accepted' | 'already_friends';
  friend: { userId: string; displayName: string };
}

export interface Friend {
  userId: string;
  displayName: string;
  level: number;
  since: string;
}
export interface FriendRequest {
  id: string;
  senderId: string;
  senderName: string;
  createdAt: string;
}

export interface PublicProfile {
  userId: string;
  displayName: string;
  level: number;
  tier: string;
  totalXp: number;
  /** The user's pet name (docs/08 §10). Optional for older APIs. */
  petName?: string | null;
  avatar: {
    config: Record<string, unknown> | null;
    equipped: Record<
      string,
      {
        slug: string;
        name: string;
        spriteAssetId: string;
        /** Resolved uploaded-sprite URL; null for `emoji:`/`color:` tokens. */
        spriteUrl?: string | null;
      }
    >;
  };
  badges: {
    slug: string;
    name: string;
    iconName: string | null;
    awardedAt: string;
  }[];
  stats: {
    lessonsCompleted: number;
    streakDays: number;
    longestStreak: number;
    friends: number;
    /** Courses with every lesson completed. Optional for older APIs. */
    coursesCompleted?: number;
    /** Owned cosmetic items. Optional for older APIs. */
    itemsOwned?: number;
  };
}

/** GET /league/history — one finished week. */
export interface LeagueHistoryEntry {
  weekStart: string;
  tier: LeagueTier;
  newTier: LeagueTier;
  finalRank: number;
  cohortSize: number;
  weeklyXp: number;
  promoted: boolean;
  demoted: boolean;
}

/** One side of GET /friends/:id/compare. */
export interface CompareStats {
  userId: string;
  displayName: string;
  level: number;
  totalXp: number;
  weeklyXp: number;
  streakDays: number;
  longestStreak: number;
  lessonsCompleted: number;
  coursesCompleted: number;
  badges: number;
}

export interface FriendCompare {
  me: CompareStats;
  friend: CompareStats;
}

/** GET /friends/activity — opted-in friends' recent activity. */
export interface ActivityFeedEntry {
  id: string;
  kind: 'LESSON_COMPLETED' | 'BADGE_UNLOCKED';
  userId: string;
  displayName: string;
  at: string;
  lessonId?: string;
  lessonTitle?: string | null;
  courseTitle?: string | null;
  badgeName?: string;
  badgeIcon?: string | null;
}

/** Typed client for /api/league, /api/friends, /api/users/:id/profile. */
@Injectable({ providedIn: 'root' })
export class LeaguesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  currentLeague(): Promise<CurrentLeague> {
    return firstValueFrom(
      this.http.get<CurrentLeague>(`${this.base}/league/current`),
    );
  }

  friends(): Promise<Friend[]> {
    return firstValueFrom(this.http.get<Friend[]>(`${this.base}/friends`));
  }

  friendRequests(): Promise<FriendRequest[]> {
    return firstValueFrom(
      this.http.get<FriendRequest[]>(`${this.base}/friends/requests`),
    );
  }

  /**
   * Always resolves `{ status: 'sent' }` (whether or not the email has an
   * account — the API doesn't reveal it). `requestId` is no longer returned.
   */
  sendFriendRequest(
    email: string,
  ): Promise<{ status: string; requestId?: string }> {
    return firstValueFrom(
      this.http.post<{ status: string; requestId?: string }>(
        `${this.base}/friends/requests`,
        { email },
        { context: withIdempotency() },
      ),
    );
  }

  /** My result for last week's cohort; rejects with a 404 ProblemDetailsError when there is none. */
  lastWeek(): Promise<LastWeekResult> {
    return firstValueFrom(
      this.http.get<LastWeekResult>(`${this.base}/league/last-week`),
    );
  }

  /** ADMIN: run the weekly rollover now (idempotent). */
  rollover(weekStart?: string): Promise<RolloverSummary> {
    return firstValueFrom(
      this.http.post<RolloverSummary>(
        `${this.base}/league/rollover`,
        weekStart ? { weekStart } : {},
        { context: withIdempotency() },
      ),
    );
  }

  /** My friend-invite link (same code as my referral link). */
  friendInvite(): Promise<FriendInvite> {
    return firstValueFrom(
      this.http.get<FriendInvite>(`${this.base}/friends/invite`),
    );
  }

  /** Accept a friend invite by code (idempotent). */
  acceptFriendInvite(code: string): Promise<AcceptInviteResult> {
    return firstValueFrom(
      this.http.post<AcceptInviteResult>(
        `${this.base}/friends/invite/${encodeURIComponent(code)}/accept`,
        {},
        { context: withIdempotency() },
      ),
    );
  }

  respondRequest(id: string, accept: boolean): Promise<{ status: string }> {
    return firstValueFrom(
      this.http.post<{ status: string }>(
        `${this.base}/friends/requests/${encodeURIComponent(id)}/respond`,
        { accept },
        { context: withIdempotency() },
      ),
    );
  }

  /** 409 if already nudged in the last 24h. `pushed` is false in quiet hours / no devices. */
  nudge(userId: string): Promise<{ status: string; pushed?: boolean }> {
    return firstValueFrom(
      this.http.post<{ status: string; pushed?: boolean }>(
        `${this.base}/friends/${encodeURIComponent(userId)}/nudge`,
        {},
        { context: withIdempotency() },
      ),
    );
  }

  /** My finished league weeks, newest first (max 52). */
  history(limit = 12): Promise<LeagueHistoryEntry[]> {
    return firstValueFrom(
      this.http.get<LeagueHistoryEntry[]>(`${this.base}/league/history`, {
        params: { limit: String(limit) },
      }),
    );
  }

  /** Side-by-side stats with a friend; 403 `FRIEND_REQUIRED` otherwise. */
  compare(friendId: string): Promise<FriendCompare> {
    return firstValueFrom(
      this.http.get<FriendCompare>(
        `${this.base}/friends/${encodeURIComponent(friendId)}/compare`,
      ),
    );
  }

  /** Opted-in friends' recent lessons + badges (docs/10 §5). */
  activity(limit = 20): Promise<ActivityFeedEntry[]> {
    return firstValueFrom(
      this.http.get<ActivityFeedEntry[]>(`${this.base}/friends/activity`, {
        params: { limit: String(limit) },
      }),
    );
  }

  profile(userId: string): Promise<PublicProfile> {
    return firstValueFrom(
      this.http.get<PublicProfile>(
        `${this.base}/users/${encodeURIComponent(userId)}/profile`,
      ),
    );
  }
}
