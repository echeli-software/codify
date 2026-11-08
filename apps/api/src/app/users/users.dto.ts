import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

/** True for any IANA zone (or alias such as "UTC") the runtime's Intl knows. */
export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function IsTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid IANA time zone (e.g. "America/Sao_Paulo")`,
        ...options,
      },
      validator: { validate: isValidTimeZone },
    });
}

/**
 * Allowed mutation surface for `PATCH /api/me`. Role/email/clerkId are
 * intentionally NOT here — those are server-managed (role via admin
 * tooling; email + clerkId via the auth provider).
 */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;

  @IsOptional()
  @IsString()
  @Length(2, 64)
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  quietHoursStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  quietHoursEnd?: number;

  @IsOptional()
  @IsBoolean()
  marketingEmailOptIn?: boolean;

  /**
   * `true` marks first-run onboarding as finished (sets `onboardedAt` once;
   * later calls keep the first timestamp). It cannot be cleared.
   */
  @IsOptional()
  @IsBoolean()
  onboarded?: boolean;

  /** Name of the user's pet (docs/08 §10); null or "" clears it. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(0, 30)
  petName?: string | null;

  /** Opt in to sharing learning activity with friends (docs/10 §5). */
  @IsOptional()
  @IsBoolean()
  activityFeedOptIn?: boolean;
}

/** Public shape returned by /api/me. Excludes deletedAt + clerkId. */
export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
  locale: string;
  timezone: string;
  marketingEmailOptIn: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  onboardedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  /** Running gamification totals; cached on the student client. */
  totalXp: number;
  coins: number;
  /** Name of the user's pet (docs/08 §10). */
  petName: string | null;
  /** Friends may see this user's learning activity (docs/10 §5). */
  activityFeedOptIn: boolean;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
  locale: string;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Subscription statuses accepted by the `subscriptionStatus` filter. */
export const SUBSCRIPTION_STATUS_FILTERS = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'UNPAID',
  'PAUSED',
  'NONE',
] as const;

/**
 * Extra `GET /api/users` filters (docs/04 "Users"). `q`, `role`, `skip`
 * and `take` stay explicit query params on the handler.
 */
export class UserListFiltersDto {
  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;

  @IsOptional()
  @IsISO8601()
  lastSeenFrom?: string;

  @IsOptional()
  @IsISO8601()
  lastSeenTo?: string;

  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUS_FILTERS)
  subscriptionStatus?: (typeof SUBSCRIPTION_STATUS_FILTERS)[number];

  // Declared so the whitelist accepts them; the handler reads them
  // through their own @Query params.
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  skip?: unknown;

  @IsOptional()
  take?: unknown;
}
