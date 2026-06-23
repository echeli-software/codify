import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export interface CertificateView {
  serial: string;
  recipientName: string;
  courseTitle: string;
  isCapstone: boolean;
  issuedAt: string;
  courseId: string;
}

export interface ReferralView {
  code: string;
  shareUrl: string;
  referredCount: number;
}

export type VerifyResult = { valid: boolean } & Partial<CertificateView>;

@Injectable({ providedIn: 'root' })
export class CertificatesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  // Student
  claim(courseId: string): Promise<CertificateView> {
    return firstValueFrom(this.http.post<CertificateView>(`${this.base}/certificates/claim`, { courseId }, { context: withIdempotency() }));
  }
  listMine(): Promise<CertificateView[]> {
    return firstValueFrom(this.http.get<CertificateView[]>(`${this.base}/me/certificates`));
  }
  referral(): Promise<ReferralView> {
    return firstValueFrom(this.http.get<ReferralView>(`${this.base}/me/referral`));
  }

  // Public
  verify(serial: string): Promise<VerifyResult> {
    return firstValueFrom(this.http.get<VerifyResult>(`${this.base}/certificates/${encodeURIComponent(serial)}`));
  }
  imageUrl(serial: string): string {
    return `${this.base}/certificates/${encodeURIComponent(serial)}/image.svg`;
  }
}
