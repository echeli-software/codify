import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import type { AdminUserListResponse, MeResponse } from './types.js';

/** `ageGroup` filter: `minor` (12–17), `adult` (18+), `none` (not given). */
export type UserAgeGroupFilter = 'minor' | 'adult' | 'none';

/** POST /admin/users/:id/birth-date outcome (age groups only, never dates). */
export interface BirthDateCorrectionResult {
  userId: string;
  before: { ageGroup: 'minor' | 'adult' | null };
  /** `deleted`: the corrected date was under 12 — the account was removed. */
  after: { ageGroup: 'minor' | 'adult' | null } | { deleted: true };
}

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
  /** ISO 3166-1 alpha-2, or `NONE` for users without a known country. */
  country?: string;
  /** docs/14 "Minors": 12–17, 18+, or no date of birth. */
  ageGroup?: UserAgeGroupFilter;
}

/** `GET /api/users/countries` row; `country: null` = unknown. */
export interface UserCountryCount {
  country: string | null;
  users: number;
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
   * &subscriptionStatus=&country= — `q` matches email or display name
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
    if (opts.country) params = params.set('country', opts.country);
    if (opts.ageGroup) params = params.set('ageGroup', opts.ageGroup);
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

  /** GET /api/users/countries — countries present (Users filter). */
  countries(): Promise<{ items: UserCountryCount[] }> {
    return firstValueFrom(
      this.http.get<{ items: UserCountryCount[] }>(
        `${this.config.baseUrl}/users/countries`,
      ),
    );
  }

  /**
   * POST /api/admin/users/:id/birth-date — staff correction (ADMIN,
   * SUPPORT), typed confirmation "CORRECT". A date under 12 deletes the
   * account. Audited with the age groups only.
   */
  correctBirthDate(
    id: string,
    body: { birthDate: string; confirm: 'CORRECT'; reason?: string },
  ): Promise<BirthDateCorrectionResult> {
    return firstValueFrom(
      this.http.post<BirthDateCorrectionResult>(
        `${this.config.baseUrl}/admin/users/${encodeURIComponent(id)}/birth-date`,
        body,
      ),
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
