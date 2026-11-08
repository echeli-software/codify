import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import { currentRequestContext } from '../common/request-context.js';

export interface AuditLogInput {
  /** Verb-style action, e.g. `user.update`, `course.publish`. */
  action: string;
  /** Optional entity name + id for filtering ("Course", "User", etc.). */
  entity?: string | null;
  entityId?: string | null;
  /** JSON diff of `before`/`after` field values. Stays open-ended. */
  diff?: Record<string, unknown> | null;
  /**
   * State before the change. Stored as `diff.before` (the convention the
   * admin audit views read); `after` likewise as `diff.after`.
   */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /**
   * Only used outside an HTTP request (jobs, workers). Inside a request the
   * client IP / user agent come from the request context (docs/14 §11), so
   * controllers don't need to pass them.
   */
  ip?: string | null;
  userAgent?: string | null;
}

/** Merge `before` / `after` into the diff JSON. */
export function auditDiff(
  input: Pick<AuditLogInput, 'diff' | 'before' | 'after'>,
): Record<string, unknown> | undefined {
  const diff: Record<string, unknown> = { ...(input.diff ?? {}) };
  if (input.before !== undefined && input.before !== null)
    diff['before'] = input.before;
  if (input.after !== undefined && input.after !== null)
    diff['after'] = input.after;
  return Object.keys(diff).length || input.diff ? diff : undefined;
}

/**
 * Writes audit-log rows for any action that mutates user-visible state.
 * Failure to persist an audit row should never abort the user's request,
 * so all errors are caught + logged. Every row gets the client IP and user
 * agent of the current request automatically (RequestContextMiddleware).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record(actor: ApiUser | null, input: AuditLogInput): Promise<void> {
    const ctx = currentRequestContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          actorId: actor?.userId ?? null,
          actorRole: actor?.role ?? null,
          entity: input.entity ?? null,
          entityId: input.entityId ?? null,
          diff: auditDiff(input) as Prisma.InputJsonValue | undefined,
          ip: ctx ? ctx.ip : (input.ip ?? null),
          userAgent: ctx ? ctx.userAgent : (input.userAgent ?? null),
        },
      });
    } catch (err) {
      this.logger.warn(
        `AuditLog write failed for "${input.action}": ${(err as Error).message}`,
      );
    }
  }
}
