import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
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
/** Per-account admin theme (docs/04 §7). */
export const USER_THEMES = [
  'light',
  'dark',
  'system',
  'high-contrast',
] as const;
export type UserTheme = (typeof USER_THEMES)[number];

/** Learning goal picked at onboarding (docs/05 "Recommended next"). */
export const ONBOARDING_GOALS = [
  'career',
  'newTech',
  'ai',
  'softSkills',
] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

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

  /**
   * Names the equipped pet (docs/08 §10); null or "" clears it. Legacy —
   * new clients use PUT /avatar/pets/:itemId/name.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(0, 30)
  petName?: string | null;

  /** Opt in to sharing learning activity with friends (docs/10 §5). */
  @IsOptional()
  @IsBoolean()
  activityFeedOptIn?: boolean;

  /** Staff UI theme (docs/04 §7); null resets to the system default. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(USER_THEMES)
  theme?: UserTheme | null;

  /**
   * Onboarding goal ranking "Recommended next" (docs/05 Today); null
   * clears it.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(ONBOARDING_GOALS)
  onboardingGoal?: OnboardingGoal | null;
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
  /**
   * The equipped pet's name (docs/08 §10; `UserItem.nickname`, falling back
   * to the legacy `User.petName`). Each pet's own name: GET /inventory.
   */
  petName: string | null;
  /** Friends may see this user's learning activity (docs/10 §5). */
  activityFeedOptIn: boolean;
  /** Staff UI theme preference (docs/04 §7), null = system. */
  theme: UserTheme | null;
  /** Onboarding goal (docs/05 "Recommended next"), null = none picked. */
  onboardingGoal: OnboardingGoal | null;
  /** ISO 3166-1 alpha-2 from the IP address (CF-IPCountry), null = unknown. */
  country: string | null;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
  locale: string;
  lastSeenAt: string | null;
  createdAt: string;
  /** ISO 3166-1 alpha-2 (CF-IPCountry), null = unknown. */
  country: string | null;
}

/** `country` list filter value for users without a known country. */
export const COUNTRY_UNKNOWN = 'NONE';

/** `GET /api/users/countries`: countries present among users. */
export interface AdminUserCountry {
  /** ISO 3166-1 alpha-2, or null for users without a known country. */
  country: string | null;
  users: number;
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

  /** ISO 3166-1 alpha-2 (any case), or `NONE` for an unknown country. */
  @IsOptional()
  @IsString()
  @Matches(/^([A-Za-z]{2}|NONE)$/, {
    message: 'country must be a two-letter ISO 3166-1 code or NONE',
  })
  country?: string;

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
