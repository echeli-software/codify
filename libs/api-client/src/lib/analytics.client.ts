import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

export interface AnalyticsEventInput {
  /** snake_case name from the docs/10 §14 catalogue. */
  name: string;
  props?: Record<string, unknown>;
  occurredAt: string;
}

export interface AnalyticsBatch {
  anonymousId?: string;
  platform?: string;
  appVersion?: string;
  events: AnalyticsEventInput[];
}

export interface AnalyticsSummaryRow {
  name: string;
  day: string;
  count: number;
}

/** First-party analytics (docs/10 §14). Batches of ≤ 50 events. */
@Injectable({ providedIn: 'root' })
export class AnalyticsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  send(batch: AnalyticsBatch): Promise<{ accepted: number }> {
    return firstValueFrom(
      this.http.post<{ accepted: number }>(
        `${this.config.baseUrl}/analytics/events`,
        batch,
      ),
    );
  }

  /** ADMIN: counts per event per UTC day. */
  summary(from?: string, to?: string): Promise<AnalyticsSummaryRow[]> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return firstValueFrom(
      this.http.get<AnalyticsSummaryRow[]>(
        `${this.config.baseUrl}/admin/analytics/summary`,
        { params },
      ),
    );
  }
}
