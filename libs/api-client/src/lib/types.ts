/**
 * Hand-typed API response shapes. These mirror the DTOs in
 * `apps/api/src/app/users/users.dto.ts` and the health controller. When
 * we wire OpenAPI codegen later, this file gets replaced by generated
 * types; the wrapper layer (clients/interceptors) stays the same.
 */

export type ApiUserRole = 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';

/** Learning goal picked at onboarding; ranks "Recommended next". */
export type OnboardingGoal = 'career' | 'newTech' | 'ai' | 'softSkills';

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
  /** Running totals updated by Progress completions. */
  totalXp: number;
  coins: number;
  /** Name of the user's pet (docs/08 §10). Optional for older APIs. */
  petName?: string | null;
  /** Friends may see this user's learning activity (docs/10 §5). */
  activityFeedOptIn?: boolean;
  /** Onboarding goal; null = none stored. Optional for older APIs. */
  onboardingGoal?: OnboardingGoal | null;
}

export interface UpdateMeBody {
  displayName?: string;
  locale?: string;
  timezone?: string;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  marketingEmailOptIn?: boolean;
  /** `true` marks first-run onboarding finished (sets `onboardedAt` once). */
  onboarded?: boolean;
  /** Pet name (max 30 chars); null or "" clears it. */
  petName?: string | null;
  /** Share learning activity with friends (docs/10 §5). */
  activityFeedOptIn?: boolean;
  /** Onboarding goal (one of four); null clears it. */
  onboardingGoal?: OnboardingGoal | null;
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
  /** `not_configured` when the API runs without REDIS_URL (dev only). */
  redis?: 'up' | 'down' | 'not_configured';
}
