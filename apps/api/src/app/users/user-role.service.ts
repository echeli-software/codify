import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UserRoleChangeResult } from './user-role.dto.js';

/**
 * Staff role changes (docs/14 §2, §11). ADMIN only (enforced on the
 * route). The role lives only in our DB — Clerk role claims are never
 * trusted — so the change takes effect on the user's next request.
 */
@Injectable()
export class UserRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async changeRole(
    actor: ApiUser,
    userId: string,
    role: UserRole,
    reason?: string,
  ): Promise<UserRoleChangeResult> {
    if (userId === actor.userId)
      // Also guarantees at least one ADMIN always remains.
      throw new ForbiddenException({
        code: 'ROLE_CHANGE_SELF',
        message: 'You cannot change your own role',
      });
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        purgedAt: true,
      },
    });
    if (!target || target.purgedAt)
      throw new NotFoundException('User not found');
    const base = {
      id: target.id,
      email: target.email,
      displayName: target.displayName,
      previousRole: target.role,
    };
    if (target.role === role) return { ...base, role, changed: false };

    // Optimistic: only flip from the role we read, so two admins racing on
    // the same user can't both "win" with a stale before-state.
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, role: target.role },
      data: { role },
    });
    if (count === 0)
      throw new ConflictException({
        code: 'ROLE_CHANGED_CONCURRENTLY',
        message: 'The role changed meanwhile; reload and try again',
      });
    await this.audit.record(actor, {
      action: 'user.role_changed',
      entity: 'User',
      entityId: userId,
      before: { role: target.role },
      after: { role },
      diff: reason?.trim() ? { reason: reason.trim() } : null,
    });
    return { ...base, role, changed: true };
  }
}
