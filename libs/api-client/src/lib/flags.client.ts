import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

/** A flag evaluated for the caller (docs/10 §9). */
export interface FlagEvaluation {
  enabled: boolean;
  /** Weighted variant, 'holdout' for the hold-out group, null without variants. */
  variant: string | null;
}

/** `FeatureFlag.value`. */
export interface FeatureFlagValue {
  enabled: boolean;
  /** 0–100 (default 100): share of non-holdout users who get the flag. */
  rolloutPct?: number;
  /** 0–100 (default 0): users carved out (enabled false, variant 'holdout'). */
  holdoutPct?: number;
  /** Variant key → integer weight. */
  variants?: Record<string, number>;
  /** 'public' flags are also served to signed-out callers. */
  surface?: string;
}

export interface FeatureFlag {
  key: string;
  value: FeatureFlagValue;
  description: string | null;
  isActive: boolean;
  /** Built-in flags (leagues/friends/shop) can be disabled but not deleted. */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeatureFlagBody {
  key: string;
  value: FeatureFlagValue;
  description?: string | null;
  isActive?: boolean;
}

export type UpdateFeatureFlagBody = Partial<Omit<CreateFeatureFlagBody, 'key'>>;

/** Problem code of a route whose flag is off (404). */
export const FEATURE_DISABLED = 'FEATURE_DISABLED';

/** Feature flags: the caller's evaluated map + admin CRUD (ADMIN). */
@Injectable({ providedIn: 'root' })
export class FlagsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** GET /flags — every flag for a signed-in caller; 'public' ones otherwise. */
  async mine(): Promise<Record<string, FlagEvaluation>> {
    const res = await firstValueFrom(
      this.http.get<{ flags: Record<string, FlagEvaluation> }>(
        `${this.config.baseUrl}/flags`,
      ),
    );
    return res.flags;
  }

  list(): Promise<{ items: FeatureFlag[] }> {
    return firstValueFrom(
      this.http.get<{ items: FeatureFlag[] }>(
        `${this.config.baseUrl}/admin/feature-flags`,
      ),
    );
  }

  create(body: CreateFeatureFlagBody): Promise<FeatureFlag> {
    return firstValueFrom(
      this.http.post<FeatureFlag>(
        `${this.config.baseUrl}/admin/feature-flags`,
        body,
      ),
    );
  }

  update(key: string, body: UpdateFeatureFlagBody): Promise<FeatureFlag> {
    return firstValueFrom(
      this.http.patch<FeatureFlag>(
        `${this.config.baseUrl}/admin/feature-flags/${encodeURIComponent(key)}`,
        body,
      ),
    );
  }

  remove(key: string): Promise<{ deleted: true; key: string }> {
    return firstValueFrom(
      this.http.delete<{ deleted: true; key: string }>(
        `${this.config.baseUrl}/admin/feature-flags/${encodeURIComponent(key)}`,
      ),
    );
  }
}
