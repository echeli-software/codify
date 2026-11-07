import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type { AuditEntryView, AuditQueryDto, Page } from './admin-ops.dto.js';
import { decodeCursor, olderThan, toPage } from './admin-ops.util.js';

/** Most rows one CSV export returns (docs/04 "Audit → Export"). */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
const EXPORT_BATCH = 1_000;

type AuditRow = AuditLog & {
  actor: { displayName: string; email: string } | null;
};

export function toAuditView(r: AuditRow): AuditEntryView {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actorId: r.actorId,
    actorName: r.actor?.displayName ?? null,
    actorEmail: r.actor?.email ?? null,
    actorRole: r.actorRole,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    diff: r.diff ?? null,
    ip: r.ip,
    userAgent: r.userAgent,
  };
}

const ACTOR_SELECT = {
  actor: { select: { displayName: true, email: true } },
} as const;

/**
 * Read side of the audit log (docs/04 "Audit", §1 permissions): ADMIN and
 * SUPPORT read everything; TEACHER only their own actions — the actor
 * filter is forced server-side. Writes stay in AuditService.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Filters → Prisma `where`, applying the TEACHER scope. */
  buildWhere(actor: ApiUser, q: AuditQueryDto): Prisma.AuditLogWhereInput {
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    if (from && to && from > to)
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'from must be before to',
      });
    const actorId = actor.role === 'TEACHER' ? actor.userId : q.actorId;
    return {
      ...(actorId ? { actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entity: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
  }

  async list(actor: ApiUser, q: AuditQueryDto): Promise<Page<AuditEntryView>> {
    const limit = q.limit ?? 50;
    const cursor = decodeCursor(q.cursor);
    const where = this.buildWhere(actor, q);
    const rows = await this.prisma.auditLog.findMany({
      where: { AND: [where, olderThan(cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: ACTOR_SELECT,
    });
    return toPage(rows, limit, toAuditView);
  }

  /** The newest `take` rows for the dashboard feed. */
  async recent(actor: ApiUser, take = 20): Promise<AuditEntryView[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: actor.role === 'TEACHER' ? { actorId: actor.userId } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: ACTOR_SELECT,
    });
    return rows.map(toAuditView);
  }

  /**
   * CSV of the filtered log, newest first, at most
   * {@link AUDIT_EXPORT_MAX_ROWS} rows (`truncated` says whether more
   * matched). Read in keyset batches so a big export never loads at once.
   */
  async exportCsv(
    actor: ApiUser,
    q: AuditQueryDto,
  ): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const where = this.buildWhere(actor, q);
    const lines = [CSV_HEADER.join(',')];
    let cursor: { createdAt: Date; id: string } | null = null;
    let count = 0;
    let truncated = false;
    for (;;) {
      const take = Math.min(EXPORT_BATCH, AUDIT_EXPORT_MAX_ROWS - count + 1);
      const batch: AuditRow[] = await this.prisma.auditLog.findMany({
        where: { AND: [where, olderThan(cursor)] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        include: ACTOR_SELECT,
      });
      for (const r of batch) {
        if (count === AUDIT_EXPORT_MAX_ROWS) {
          truncated = true;
          break;
        }
        lines.push(toCsvRow(toAuditView(r)));
        count += 1;
      }
      if (truncated || batch.length < take) break;
      const last = batch[batch.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    return { csv: lines.join('\r\n') + '\r\n', rows: count, truncated };
  }
}

export const CSV_HEADER = [
  'createdAt',
  'actorId',
  'actorEmail',
  'actorRole',
  'action',
  'entity',
  'entityId',
  'diff',
  'ip',
] as const;

/**
 * RFC 4180 cell: quoted when needed, and spreadsheet formula prefixes
 * (= + - @ tab CR) neutralised with a leading apostrophe (CSV injection).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvRow(v: AuditEntryView): string {
  return [
    v.createdAt,
    v.actorId,
    v.actorEmail,
    v.actorRole,
    v.action,
    v.entity,
    v.entityId,
    v.diff,
    v.ip,
  ]
    .map(csvCell)
    .join(',');
}
