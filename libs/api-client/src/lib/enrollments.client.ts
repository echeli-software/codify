import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export type EnrollmentSource = 'SELF' | 'PROMO' | 'ADMIN_GRANT';

export interface EnrollmentView {
  id: string;
  courseId: string;
  source: EnrollmentSource;
  accessUntil: string | null;
  createdAt: string;
}

export interface MyEnrollment extends EnrollmentView {
  course: {
    id: string;
    slug: string;
    title: string;
    coverAssetId: string | null;
    isCapstone: boolean;
  };
  progress: { completedLessons: number; totalLessons: number };
  grantsAccess: boolean;
}

export interface GrantEnrollmentBody {
  userId: string;
  courseId: string;
  source: 'PROMO' | 'ADMIN_GRANT';
  accessUntil?: string;
  reason?: string;
}

/** "My courses" + admin/support course grants (docs/09 §3). */
@Injectable({ providedIn: 'root' })
export class EnrollmentsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  enroll(courseId: string): Promise<EnrollmentView> {
    return firstValueFrom(
      this.http.post<EnrollmentView>(
        `${this.base}/courses/${encodeURIComponent(courseId)}/enroll`,
        {},
        { context: withIdempotency() },
      ),
    );
  }

  /** 409 `ENROLLMENT_GRANTED` for PROMO/ADMIN_GRANT enrollments. */
  unenroll(courseId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/courses/${encodeURIComponent(courseId)}/enroll`,
      ),
    );
  }

  mine(): Promise<MyEnrollment[]> {
    return firstValueFrom(
      this.http.get<MyEnrollment[]>(`${this.base}/me/enrollments`),
    );
  }

  forUser(userId: string): Promise<EnrollmentView[]> {
    return firstValueFrom(
      this.http.get<EnrollmentView[]>(
        `${this.base}/admin/users/${encodeURIComponent(userId)}/enrollments`,
      ),
    );
  }

  /** SUPPORT: PROMO only, ending within 31 days. */
  grant(body: GrantEnrollmentBody): Promise<EnrollmentView> {
    return firstValueFrom(
      this.http.post<EnrollmentView>(`${this.base}/admin/enrollments`, body, {
        context: withIdempotency(),
      }),
    );
  }

  revoke(id: string): Promise<EnrollmentView> {
    return firstValueFrom(
      this.http.delete<EnrollmentView>(
        `${this.base}/admin/enrollments/${encodeURIComponent(id)}`,
      ),
    );
  }
}
