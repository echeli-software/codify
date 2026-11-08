import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import type { MeResponse, UpdateMeBody } from './types.js';

/**
 * Typed client for the current-user endpoints. Both apps inject this and
 * never call HttpClient against `/api/me` directly — keeps the
 * Authorization / Accept-Language / problem-details wiring DRY.
 */
@Injectable({ providedIn: 'root' })
export class MeClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** GET /api/me */
  me(): Promise<MeResponse> {
    return firstValueFrom(
      this.http.get<MeResponse>(`${this.config.baseUrl}/me`),
    );
  }

  /**
   * PUT /api/me/birth-date — set once. 400 BIRTH_DATE_INVALID (`reason`:
   * invalid | future | too_old), 409 BIRTH_DATE_ALREADY_SET, 403
   * AGE_BELOW_MINIMUM (under 12: the account was deleted — sign out).
   */
  setBirthDate(birthDate: string): Promise<MeResponse> {
    return firstValueFrom(
      this.http.put<MeResponse>(`${this.config.baseUrl}/me/birth-date`, {
        birthDate,
      }),
    );
  }

  /** PATCH /api/me */
  update(patch: UpdateMeBody): Promise<MeResponse> {
    return firstValueFrom(
      this.http.patch<MeResponse>(`${this.config.baseUrl}/me`, patch),
    );
  }
}
