import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type BillingPeriod = 'MONTHLY' | 'ANNUAL';

export interface PlanPrice {
  id: string;
  currency: string;
  amountCents: number;
  period: BillingPeriod;
  maxInstallments: number | null;
  isActive: boolean;
  stripePriceId: string | null;
  /** App Store / Play product id sold through RevenueCat. */
  storeProductId: string | null;
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tagline: string | null;
  isAllAccess: boolean;
  revenueCatEntitlementId: string | null;
  isActive: boolean;
  trialDays: number;
  sortOrder: number;
  categoryIds: string[];
  prices: PlanPrice[];
  stripeProductId: string | null;
  syncedToStripe: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlanListResponse {
  items: Plan[];
  total: number;
}

export interface PlanPriceInput {
  currency: string;
  amountCents: number;
  period: BillingPeriod;
  maxInstallments?: number;
  storeProductId?: string;
}

/** Amount / currency / period are immutable; '' clears storeProductId. */
export interface UpdatePlanPriceBody {
  storeProductId?: string;
  isActive?: boolean;
  maxInstallments?: number | null;
}

export interface CreatePlanBody {
  slug: string;
  name: string;
  description?: string;
  tagline?: string;
  isAllAccess?: boolean;
  revenueCatEntitlementId?: string;
  trialDays?: number;
  sortOrder?: number;
  categoryIds?: string[];
  prices?: PlanPriceInput[];
}

export type UpdatePlanBody = Partial<
  Omit<CreatePlanBody, 'prices'> & { isActive: boolean }
>;

/**
 * Typed client for /api/plans. Reads list active plans (optionally filtered
 * to a course via `courseId` — the "plans including this course" surface);
 * staff pass `includeInactive` to see drafts. All mutations + sync ride the
 * idempotency interceptor.
 */
@Injectable({ providedIn: 'root' })
export class PlansClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  list(
    opts: { includeInactive?: boolean; courseId?: string } = {},
  ): Promise<PlanListResponse> {
    let params = new HttpParams();
    if (opts.includeInactive) params = params.set('includeInactive', 'true');
    if (opts.courseId) params = params.set('courseId', opts.courseId);
    return firstValueFrom(
      this.http.get<PlanListResponse>(`${this.config.baseUrl}/plans`, {
        params,
      }),
    );
  }

  detail(id: string): Promise<Plan> {
    return firstValueFrom(
      this.http.get<Plan>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}`,
      ),
    );
  }

  create(body: CreatePlanBody): Promise<Plan> {
    return firstValueFrom(
      this.http.post<Plan>(`${this.config.baseUrl}/plans`, body, {
        context: withIdempotency(),
      }),
    );
  }

  update(id: string, body: UpdatePlanBody): Promise<Plan> {
    return firstValueFrom(
      this.http.patch<Plan>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}`,
        body,
        {
          context: withIdempotency(),
        },
      ),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}`,
      ),
    );
  }

  addPrice(id: string, body: PlanPriceInput): Promise<Plan> {
    return firstValueFrom(
      this.http.post<Plan>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}/prices`,
        body,
        {
          context: withIdempotency(),
        },
      ),
    );
  }

  updatePrice(
    id: string,
    priceId: string,
    body: UpdatePlanPriceBody,
  ): Promise<Plan> {
    return firstValueFrom(
      this.http.patch<Plan>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}/prices/${encodeURIComponent(priceId)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  removePrice(id: string, priceId: string): Promise<Plan> {
    return firstValueFrom(
      this.http.delete<Plan>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}/prices/${encodeURIComponent(priceId)}`,
      ),
    );
  }

  syncToStripe(id: string): Promise<Plan> {
    return firstValueFrom(
      this.http.post<Plan>(
        `${this.config.baseUrl}/plans/${encodeURIComponent(id)}/sync-stripe`,
        {},
        { context: withIdempotency() },
      ),
    );
  }
}
