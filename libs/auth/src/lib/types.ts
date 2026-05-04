/**
 * Public auth types. Roles match the Prisma `UserRole` enum so the same
 * names round-trip through the API and through localStorage stubs.
 *
 * In production the `AuthUser` is hydrated from a Clerk session JWT (the
 * server is the source of truth for `role`); in dev/stub mode it lives in
 * a localStorage entry keyed by `STUB_USER_KEY`.
 */
export type UserRole = 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';

export const ALL_ROLES: readonly UserRole[] = ['STUDENT', 'TEACHER', 'SUPPORT', 'ADMIN'];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** Optional avatar URL. */
  avatarUrl?: string | null;
  /** ISO locale tag — `pt-BR`, `en-US`, etc. */
  locale?: string;
}

export interface AuthSession {
  /** Bearer token included on outgoing API requests. */
  token: string;
  /** Epoch ms when the token expires; null = no expiry tracked. */
  expiresAt?: number | null;
}

export interface AuthState {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
}
