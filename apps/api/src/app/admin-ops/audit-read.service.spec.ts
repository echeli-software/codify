import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  AUDIT_EXPORT_MAX_ROWS,
  AuditReadService,
  csvCell,
} from './audit-read.service.js';
import { decodeCursor, encodeCursor } from './admin-ops.util.js';

const staff = (role: ApiUser['role']): ApiUser => ({
  userId: `${role}-1`,
  clerkId: 'c',
  email: 'x@x',
  role,
  displayName: 'X',
});

function row(i: number) {
  return {
    id: `id-${String(i).padStart(6, '0')}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, 0) - i * 1000),
    actorId: 'a1',
    actorRole: 'ADMIN',
    action: 'user.item_grant',
    entity: 'User',
    entityId: 'u1',
    diff: { reason: 'x' },
    ip: null,
    userAgent: null,
    actor: { displayName: 'Ana', email: 'ana@x' },
  };
}

describe('AuditReadService', () => {
  it('forces the actor filter for teachers', () => {
    const svc = new AuditReadService({} as PrismaService);
    expect(
      svc.buildWhere(staff('TEACHER'), { actorId: 'someone-else' }),
    ).toEqual({ actorId: 'TEACHER-1' });
    expect(
      svc.buildWhere(staff('SUPPORT'), {
        actorId: 'a1',
        action: 'user.',
        entityType: 'User',
        entityId: 'u1',
        from: '2026-11-01T00:00:00Z',
        to: '2026-11-02T00:00:00Z',
      }),
    ).toEqual({
      actorId: 'a1',
      action: { startsWith: 'user.' },
      entity: 'User',
      entityId: 'u1',
      createdAt: {
        gte: new Date('2026-11-01T00:00:00Z'),
        lte: new Date('2026-11-02T00:00:00Z'),
      },
    });
  });

  it('rejects inverted ranges', () => {
    const svc = new AuditReadService({} as PrismaService);
    expect(() =>
      svc.buildWhere(staff('ADMIN'), {
        from: '2026-11-02T00:00:00Z',
        to: '2026-11-01T00:00:00Z',
      }),
    ).toThrow();
  });

  it('pages with a keyset cursor', async () => {
    const rows = [row(0), row(1), row(2)];
    const prisma = { auditLog: { findMany: jest.fn(async () => rows) } };
    const svc = new AuditReadService(prisma as unknown as PrismaService);
    const page = await svc.list(staff('ADMIN'), { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual([rows[0].id, rows[1].id]);
    expect(page.items[0]).toMatchObject({
      actorName: 'Ana',
      actorEmail: 'ana@x',
    });
    expect(decodeCursor(page.nextCursor!)).toEqual({
      createdAt: rows[1].createdAt,
      id: rows[1].id,
    });

    await svc.list(staff('ADMIN'), { limit: 2, cursor: page.nextCursor! });
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 3,
        where: {
          AND: [
            {},
            {
              OR: [
                { createdAt: { lt: rows[1].createdAt } },
                { createdAt: rows[1].createdAt, id: { lt: rows[1].id } },
              ],
            },
          ],
        },
      }),
    );
  });

  it('rejects a garbage cursor', async () => {
    const svc = new AuditReadService({
      auditLog: { findMany: jest.fn() },
    } as never);
    await expect(
      svc.list(staff('ADMIN'), { cursor: 'nope' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CURSOR' },
    });
    expect(encodeCursor({ createdAt: new Date(0), id: 'x' })).toBeTruthy();
  });

  it('exports CSV in batches and flags truncation at the cap', async () => {
    const total = AUDIT_EXPORT_MAX_ROWS + 5;
    const all = Array.from({ length: total }, (_, i) => row(i));
    const prisma = {
      auditLog: {
        findMany: jest.fn(
          async (args: {
            take: number;
            where: { AND: [unknown, { OR?: [{ createdAt: { lt: Date } }] }] };
          }) => {
            const before = args.where.AND[1].OR?.[0].createdAt.lt;
            const start = before
              ? all.findIndex((r) => r.createdAt < before)
              : 0;
            return all.slice(start, start + args.take);
          },
        ),
      },
    };
    const svc = new AuditReadService(prisma as unknown as PrismaService);
    const out = await svc.exportCsv(staff('ADMIN'), {});
    expect(out.rows).toBe(AUDIT_EXPORT_MAX_ROWS);
    expect(out.truncated).toBe(true);
    const lines = out.csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(AUDIT_EXPORT_MAX_ROWS + 1);
    expect(lines[0]).toBe(
      'createdAt,actorId,actorEmail,actorRole,action,entity,entityId,diff,ip',
    );
    expect(lines[1]).toContain('"{""reason"":""x""}"');
  });

  it('export of a small set is not truncated', async () => {
    const prisma = { auditLog: { findMany: jest.fn(async () => [row(0)]) } };
    const svc = new AuditReadService(prisma as unknown as PrismaService);
    const out = await svc.exportCsv(staff('ADMIN'), {});
    expect(out).toMatchObject({ rows: 1, truncated: false });
  });
});

describe('csvCell', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
});
