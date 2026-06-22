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
  avatar: { config: Record<string, unknown> | null; equipped: Record<string, { slug: string; name: string; spriteAssetId: string }> };
  badges: { slug: string; name: string; iconName: string | null; awardedAt: string }[];
  stats: { lessonsCompleted: number; streakDays: number; longestStreak: number; friends: number };
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
    return firstValueFrom(this.http.get<CurrentLeague>(`${this.base}/league/current`));
  }

  friends(): Promise<Friend[]> {
    return firstValueFrom(this.http.get<Friend[]>(`${this.base}/friends`));
  }

  friendRequests(): Promise<FriendRequest[]> {
    return firstValueFrom(this.http.get<FriendRequest[]>(`${this.base}/friends/requests`));
  }

  sendFriendRequest(email: string): Promise<{ status: string; requestId?: string }> {
    return firstValueFrom(this.http.post<{ status: string; requestId?: string }>(`${this.base}/friends/requests`, { email }, { context: withIdempotency() }));
  }

  respondRequest(id: string, accept: boolean): Promise<{ status: string }> {
    return firstValueFrom(this.http.post<{ status: string }>(`${this.base}/friends/requests/${encodeURIComponent(id)}/respond`, { accept }, { context: withIdempotency() }));
  }

  nudge(userId: string): Promise<{ status: string }> {
    return firstValueFrom(this.http.post<{ status: string }>(`${this.base}/friends/${encodeURIComponent(userId)}/nudge`, {}, { context: withIdempotency() }));
  }

  profile(userId: string): Promise<PublicProfile> {
    return firstValueFrom(this.http.get<PublicProfile>(`${this.base}/users/${encodeURIComponent(userId)}/profile`));
  }
}
