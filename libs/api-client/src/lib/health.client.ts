import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import type { HealthResponse } from './types.js';

/**
 * Typed client for the public /api/health endpoint. Useful for ops
 * dashboards and an in-app "API status" indicator if/when one ships.
 */
@Injectable({ providedIn: 'root' })
export class HealthClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  check(): Promise<HealthResponse> {
    return firstValueFrom(
      this.http.get<HealthResponse>(`${this.config.baseUrl}/health`),
    );
  }
}
