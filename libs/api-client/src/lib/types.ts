/**
 * Hand-typed API response shapes. These mirror the DTOs in
 * `apps/api/src/app/users/users.dto.ts` and the health controller. When
 * we wire OpenAPI codegen later, this file gets replaced by generated
 * types; the wrapper layer (clients/interceptors) stays the same.
 */

export type ApiUserRole = 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  role: ApiUserRole;
  locale: string;
  timezone: string;
  marketingEmailOptIn: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  onboardedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface UpdateMeBody {
  displayName?: string;
  locale?: string;
  timezone?: string;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  marketingEmailOptIn?: boolean;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  displayName: string;
  role: ApiUserRole;
  locale: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  total: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: 'up' | 'down';
}
