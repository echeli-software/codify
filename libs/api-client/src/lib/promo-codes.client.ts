import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

/** A coin promo code (docs/08 §12), as the admin API returns it. */
export interface PromoCode {
  id: string;
  /** Stored upper-case; redeemed case-insensitively. */
  code: string;
  coins: number;
  maxRedemptions: number | null;
  redemptions: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  description: string | null;
  /** Active, inside its window and not exhausted right now. */
  redeemableNow: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromoCodeBody {
  code: string;
  coins: number;
  maxRedemptions?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  description?: string | null;
}

export type UpdatePromoCodeBody = Partial<Omit<CreatePromoCodeBody, 'code'>>;

export interface RedeemPromoCodeResult {
  code: string;
  coins: number;
  totals: { totalXp: number; coins: number; level: number };
}

/**
 * `code` values on POST /me/promo-codes/redeem errors: 404 NOT_FOUND,
 * 400 NOT_STARTED, 410 EXPIRED, 409 ALREADY_REDEEMED / EXHAUSTED,
 * 429 RATE_LIMITED (10 failed tries per hour).
 */
export type PromoCodeErrorCode =
  | 'PROMO_CODE_NOT_FOUND'
  | 'PROMO_CODE_NOT_STARTED'
  | 'PROMO_CODE_EXPIRED'
  | 'PROMO_CODE_ALREADY_REDEEMED'
  | 'PROMO_CODE_EXHAUSTED'
  | 'PROMO_CODE_RATE_LIMITED';

/** Coin promo codes: admin CRUD + student redemption. */
@Injectable({ providedIn: 'root' })
export class PromoCodesClient {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_CLIENT_CONFIG).baseUrl;

  /** STUDENT: redeem a code (once per user). */
  redeem(code: string): Promise<RedeemPromoCodeResult> {
    return firstValueFrom(
      this.http.post<RedeemPromoCodeResult>(
        `${this.base}/me/promo-codes/redeem`,
        { code },
        { context: withIdempotency() },
      ),
    );
  }

  /** ADMIN */
  list(): Promise<PromoCode[]> {
    return firstValueFrom(
      this.http.get<PromoCode[]>(`${this.base}/admin/promo-codes`),
    );
  }

  create(body: CreatePromoCodeBody): Promise<PromoCode> {
    return firstValueFrom(
      this.http.post<PromoCode>(`${this.base}/admin/promo-codes`, body, {
        context: withIdempotency(),
      }),
    );
  }

  update(id: string, body: UpdatePromoCodeBody): Promise<PromoCode> {
    return firstValueFrom(
      this.http.patch<PromoCode>(
        `${this.base}/admin/promo-codes/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  remove(id: string): Promise<{ deleted: boolean }> {
    return firstValueFrom(
      this.http.delete<{ deleted: boolean }>(
        `${this.base}/admin/promo-codes/${encodeURIComponent(id)}`,
      ),
    );
  }
}
