import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

/** `PushSubscription.toJSON()` — what the API stores per browser. */
export interface WebPushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Browser web push (VAPID) registration for the PWA (docs/10 §3):
 *   - `config()` → the server's VAPID public key; rejects with a
 *     ProblemDetailsError 404 `WEB_PUSH_DISABLED` when web push is off;
 *   - `subscribe()` binds this browser's subscription to the signed-in user;
 *   - `unsubscribe()` removes it (own rows only).
 */
@Injectable({ providedIn: 'root' })
export class WebPushClient {
  private readonly http = inject(HttpClient);
  private readonly config_ = inject(API_CLIENT_CONFIG);
  private get base() {
    return `${this.config_.baseUrl}/push/web`;
  }

  config(): Promise<{ publicKey: string }> {
    return firstValueFrom(
      this.http.get<{ publicKey: string }>(`${this.base}/config`),
    );
  }

  subscribe(body: WebPushSubscriptionBody): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>(`${this.base}/subscriptions`, {
        endpoint: body.endpoint,
        keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      }),
    );
  }

  unsubscribe(endpoint: string): Promise<{ removed: number }> {
    return firstValueFrom(
      this.http.delete<{ removed: number }>(`${this.base}/subscriptions`, {
        body: { endpoint },
      }),
    );
  }
}
