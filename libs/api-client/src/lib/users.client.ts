import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import type { AdminUserListResponse, MeResponse } from './types.js';

/** `subscriptionStatus` filter: a status, or NONE for never subscribed. */
export type UserSubscriptionFilter =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED'
  | 'NONE';

export interface UserListQuery {
  skip?: number;
  take?: number;
  q?: string;
  role?: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
  /** Exact locale, e.g. `pt-BR`. */
  locale?: string;
  /** ISO-8601 bounds on `lastSeenAt` (inclusive). */
  lastSeenFrom?: string;
  lastSeenTo?: string;
  subscriptionStatus?: UserSubscriptionFilter;
}

/**
 * Typed client for admin-side user management. The API enforces
 * `@Roles('ADMIN','SUPPORT')` on these endpoints — non-staff calls
 * land as 403 ProblemDetailsError, which the caller can branch on.
 */
@Injectable({ providedIn: 'root' })
export class UsersClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /**
   * GET /api/users?skip=&take=&q=&role=&locale=&lastSeenFrom=&lastSeenTo=
   * &subscriptionStatus= — `q` matches email or display name
   * (case-insensitive substring) or an exact user id.
   */
  list(opts: UserListQuery = {}): Promise<AdminUserListResponse> {
    let params = new HttpParams();
    if (opts.q) params = params.set('q', opts.q);
    if (opts.role) params = params.set('role', opts.role);
    if (opts.locale) params = params.set('locale', opts.locale);
    if (opts.lastSeenFrom)
      params = params.set('lastSeenFrom', opts.lastSeenFrom);
    if (opts.lastSeenTo) params = params.set('lastSeenTo', opts.lastSeenTo);
    if (opts.subscriptionStatus)
      params = params.set('subscriptionStatus', opts.subscriptionStatus);
    if (typeof opts.skip === 'number')
      params = params.set('skip', String(opts.skip));
    if (typeof opts.take === 'number')
      params = params.set('take', String(opts.take));
    return firstValueFrom(
      this.http.get<AdminUserListResponse>(`${this.config.baseUrl}/users`, {
        params,
      }),
    );
  }

  /** GET /api/users/:id */
  detail(id: string): Promise<MeResponse> {
    return firstValueFrom(
      this.http.get<MeResponse>(
        `${this.config.baseUrl}/users/${encodeURIComponent(id)}`,
      ),
    );
  }
}
