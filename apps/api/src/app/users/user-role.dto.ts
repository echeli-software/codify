import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';

/** Body for PATCH /admin/users/:id/role (docs/04 Users, docs/14 §11). */
export class ChangeUserRoleDto {
  @IsIn(Object.values(UserRole))
  role!: UserRole;

  /** Optional note stored in the audit row. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface UserRoleChangeResult {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  previousRole: UserRole;
  /** False when the user already had the requested role (no audit row). */
  changed: boolean;
}
