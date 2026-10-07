import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export interface LeagueMember {
  userId: string;
  displayName: string;
  weeklyXp: number;
  level: number;
  rank: number;
  isMe: boolean;
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
  avatar: {
    config: Record<string, unknown> | null;
    equipped: Record<
      string,
      { slug: string; name: string; spriteAssetId: string }
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
  };
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

  profile(userId: string): Promise<PublicProfile> {
    return firstValueFrom(
      this.http.get<PublicProfile>(
        `${this.base}/users/${encodeURIComponent(userId)}/profile`,
      ),
    );
  }
}
