import type { ApiUser } from './auth.types.js';

/**
 * Server-side staff session rules (docs/14 §1, §18): staff roles with
 * admin powers need a verified second factor and a sign-in younger than
 * 12 h, read from the Clerk session token's factor-verification-age claim
 * `fva: [minutesSinceFirstFactor, minutesSinceSecondFactor]` (-1 = never
 * in this session). Signing in again (or Clerk step-up reverification)
 * resets both. Dev tokens carry no claims and are exempt (dev only).
 *
 * SUPPORT is included by default: it can suspend accounts, refund and read
 * PII, so it gets the same protection as ADMIN. TEACHER is not (optional
 * MFA, docs/14 §1).
 */

export interface StaffSessionPolicy {
  /** Roles that must pass the checks. Empty = disabled (break-glass). */
  roles: readonly ApiUser['role'][];
  /** Absolute session age limit, minutes since the first factor. */
  maxAgeMinutes: number;
}

export const DEFAULT_STAFF_SESSION_POLICY: StaffSessionPolicy = {
  roles: ['ADMIN', 'SUPPORT'],
  maxAgeMinutes: 12 * 60,
};

export type StaffSessionCode = 'MFA_REQUIRED' | 'SESSION_TOO_OLD';

export interface StaffSessionBlock {
  code: StaffSessionCode;
  message: string;
  maxSessionHours: number;
}

const VALID_ROLES = ['STUDENT', 'TEACHER', 'SUPPORT', 'ADMIN'] as const;

/** Policy from STAFF_MFA_ROLES (comma list, "none" disables) + STAFF_SESSION_MAX_HOURS. */
export function staffSessionPolicyFromEnv(env: {
  STAFF_MFA_ROLES?: string;
  STAFF_SESSION_MAX_HOURS?: number;
}): StaffSessionPolicy {
  const raw = env.STAFF_MFA_ROLES?.trim();
  let roles: ApiUser['role'][] = [...DEFAULT_STAFF_SESSION_POLICY.roles];
  if (raw !== undefined) {
    roles =
      raw.toLowerCase() === 'none'
        ? []
        : raw
            .split(',')
            .map((r) => r.trim().toUpperCase())
            .filter((r): r is ApiUser['role'] =>
              (VALID_ROLES as readonly string[]).includes(r),
            );
  }
  const hours = env.STAFF_SESSION_MAX_HOURS ?? 12;
  return { roles, maxAgeMinutes: Math.round(hours * 60) };
}

/** Routes a blocked staff session may still call: identity + account status. */
const ALLOWED = [
  /^(?:\/[^/]+)?\/me\/?$/,
  /^(?:\/[^/]+)?\/me\/account-status\/?$/,
];

function fvaOf(claims: Record<string, unknown>): [number, number] | null {
  const fva = claims['fva'];
  if (
    Array.isArray(fva) &&
    fva.length >= 2 &&
    typeof fva[0] === 'number' &&
    typeof fva[1] === 'number'
  )
    return [fva[0], fva[1]];
  return null;
}

/**
 * Null when the request may proceed. `claims` is the verified Clerk token
 * payload (undefined for dev tokens → exempt). `path` excludes the query.
 */
export function staffSessionBlockFor(
  role: ApiUser['role'],
  claims: Record<string, unknown> | undefined,
  method: string,
  path: string,
  policy: StaffSessionPolicy = DEFAULT_STAFF_SESSION_POLICY,
): StaffSessionBlock | null {
  if (!claims || !policy.roles.includes(role)) return null;
  if (method.toUpperCase() === 'GET' && ALLOWED.some((r) => r.test(path)))
    return null;
  const maxSessionHours = policy.maxAgeMinutes / 60;
  const fva = fvaOf(claims);
  // No fva claim (or no second factor this session) → can't prove MFA.
  if (!fva || fva[1] < 0)
    return {
      code: 'MFA_REQUIRED',
      message:
        'This role requires two-step verification: enable it in your account and sign in again.',
      maxSessionHours,
    };
  if (fva[0] < 0 || fva[0] > policy.maxAgeMinutes)
    return {
      code: 'SESSION_TOO_OLD',
      message: `Staff sessions expire ${maxSessionHours} h after sign-in: sign in again.`,
      maxSessionHours,
    };
  return null;
}
