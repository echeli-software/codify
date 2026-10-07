import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import type { AdminUserListResponse, MeResponse } from './types.js';

/**
 * Typed client for admin-side user management. The API enforces
 * `@Roles('ADMIN','SUPPORT')` on these endpoints — non-staff calls
 * land as 403 ProblemDetailsError, which the caller can branch on.
 */
@Injectable({ providedIn: 'root' })
export class UsersClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** GET /api/users?skip=&take= */
  list(
    opts: { skip?: number; take?: number } = {},
  ): Promise<AdminUserListResponse> {
    let params = new HttpParams();
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
