import { IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';

/** POST /api/admin/enrollments — grant course access outside a subscription. */
export class GrantEnrollmentDto {
  @IsString()
  @Length(1, 64)
  userId!: string;

  @IsString()
  @Length(1, 64)
  courseId!: string;

  @IsIn(['PROMO', 'ADMIN_GRANT'])
  source!: 'PROMO' | 'ADMIN_GRANT';

  /** ISO end of access; omit for no expiry (ADMIN only — SUPPORT must set ≤ 31 days). */
  @IsOptional()
  @IsISO8601({ strict: true })
  accessUntil?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export interface EnrollmentView {
  id: string;
  courseId: string;
  source: 'SELF' | 'PROMO' | 'ADMIN_GRANT';
  /** Paid access window for PROMO/ADMIN_GRANT; null = no expiry. SELF never grants paid access. */
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
  /** True while a PROMO/ADMIN_GRANT window is open. */
  grantsAccess: boolean;
}
