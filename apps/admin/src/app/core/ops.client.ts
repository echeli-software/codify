import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from '@codify/api-client';

/** Mirrors `LedgerDriftMismatch` in apps/api/src/app/ops. */
export interface LedgerDriftMismatch {
  userId: string;
  coins: number;
  sumDelta: number;
  latestBalanceAfter: number | null;
  transactionCount: number;
}

/** Mirrors `LedgerDriftReport` in apps/api/src/app/ops. */
export interface LedgerDriftReport {
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usersChecked: number;
  mismatchCount: number;
  mismatches: LedgerDriftMismatch[];
}

/**
 * `/api/admin/ops/*` (ADMIN). Lives in the admin app because
 * @codify/api-client has no ops client yet — move it there when it does.
 */
@Injectable({ providedIn: 'root' })
export class OpsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** Last coin-ledger drift report (null until the first run since boot). */
  lastDrift(): Promise<{ report: LedgerDriftReport | null }> {
    return firstValueFrom(
      this.http.get<{ report: LedgerDriftReport | null }>(
        `${this.config.baseUrl}/admin/ops/drift`,
      ),
    );
  }

  /** Run the drift check now. */
  runDrift(): Promise<{ report: LedgerDriftReport }> {
    return firstValueFrom(
      this.http.post<{ report: LedgerDriftReport }>(
        `${this.config.baseUrl}/admin/ops/drift`,
        {},
      ),
    );
  }
}
