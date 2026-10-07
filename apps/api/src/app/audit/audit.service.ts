import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';

export interface AuditLogInput {
  /** Verb-style action, e.g. `user.update`, `course.publish`. */
  action: string;
  /** Optional entity name + id for filtering ("Course", "User", etc.). */
  entity?: string | null;
  entityId?: string | null;
  /** JSON diff of `before`/`after` field values. Stays open-ended. */
  diff?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Writes audit-log rows for any action that mutates user-visible state.
 * Failure to persist an audit row should never abort the user's request,
 * so all errors are caught + logged. Read-side queries land later under
 * an admin "Activity" page.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record(actor: ApiUser | null, input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          actorId: actor?.userId ?? null,
          actorRole: actor?.role ?? null,
          entity: input.entity ?? null,
          entityId: input.entityId ?? null,
          diff: (input.diff ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `AuditLog write failed for "${input.action}": ${(err as Error).message}`,
      );
    }
  }
}
