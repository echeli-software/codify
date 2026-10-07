import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

/** GET /me/referral — a superset of CertificatesClient's ReferralView. */
export interface ReferralSummary {
  code: string;
  shareUrl: string;
  /** Users who signed up with my code (same as `invited`). */
  referredCount: number;
  invited: number;
  /** Referees who completed at least one lesson. */
  converted: number;
  /** Rewards paid to me for converted referees. */
  rewards: { count: number; xp: number; coins: number };
}

export interface ClaimReferralResult {
  status: 'claimed' | 'already_claimed';
}

/**
 * Typed client for referrals (docs/18-growth.md).
 * Claim errors: 404 unknown code, 400 self / outside the 14-day window /
 * circular, 409 a different referral was already claimed.
 */
@Injectable({ providedIn: 'root' })
export class ReferralsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  summary(): Promise<ReferralSummary> {
    return firstValueFrom(
      this.http.get<ReferralSummary>(`${this.base}/me/referral`),
    );
  }

  /** Attribute my signup to the owner of `code` (once, ≤ 14 days after signup). */
  claim(code: string): Promise<ClaimReferralResult> {
    return firstValueFrom(
      this.http.post<ClaimReferralResult>(
        `${this.base}/me/referral/claim`,
        { code },
        { context: withIdempotency() },
      ),
    );
  }

  /** ADMIN: pay pending referrer rewards now (the hourly job does this too). */
  runRewards(): Promise<{ candidates: number; rewarded: number }> {
    return firstValueFrom(
      this.http.post<{ candidates: number; rewarded: number }>(
        `${this.base}/admin/referrals/rewards/run`,
        {},
        { context: withIdempotency() },
      ),
    );
  }
}
