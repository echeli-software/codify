import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  registerDecorator,
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
