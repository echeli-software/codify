import { AuditService } from './audit.service.js';
import type { ApiUser } from '../auth/auth.types.js';

describe('AuditService', () => {
  it('persists with actor + diff', async () => {
    const created: unknown[] = [];
    const prisma = {
      auditLog: { create: async (args: unknown) => (created.push(args), {}) },
    };
    const svc = new AuditService(prisma as never);
    const actor: ApiUser = {
      userId: 'u1',
      clerkId: 'c1',
      email: 'a@x',
      role: 'ADMIN',
      displayName: 'A',
    };
    await svc.record(actor, {
      action: 'user.update_self',
      entity: 'User',
      entityId: 'u1',
      diff: { displayName: 'New' },
    });
    expect(created).toHaveLength(1);
    expect((created[0] as { data: { actorId: string } }).data.actorId).toBe('u1');
    expect((created[0] as { data: { actorRole: string } }).data.actorRole).toBe('ADMIN');
    expect((created[0] as { data: { action: string } }).data.action).toBe(
      'user.update_self',
    );
  });

  it('swallows persistence failures so the user request never fails', async () => {
    const prisma = {
      auditLog: {
        create: async () => {
          throw new Error('boom');
        },
      },
    };
    const svc = new AuditService(prisma as never);
    await expect(
      svc.record(null, { action: 'system.test' }),
    ).resolves.toBeUndefined();
  });
});
