import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  quietHoursStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
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
