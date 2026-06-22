import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type DevicePlatform = 'IOS' | 'ANDROID' | 'WEB';

/** Push device-token registration (Phase 11 — native push). */
@Injectable({ providedIn: 'root' })
export class DevicesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  register(token: string, platform: DevicePlatform): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>(`${this.base}/devices`, { token, platform }, { context: withIdempotency() }),
    );
  }

  unregister(token: string): Promise<{ removed: number }> {
    return firstValueFrom(this.http.delete<{ removed: number }>(`${this.base}/devices/${encodeURIComponent(token)}`));
  }
}
