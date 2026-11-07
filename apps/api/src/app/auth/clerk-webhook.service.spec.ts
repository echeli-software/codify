import { Prisma } from '@prisma/client';
import { ClerkWebhookService } from './clerk-webhook.service.js';

interface U {
  id: string;
  clerkId: string;
  email: string;
  displayName: string;
  deletedAt: Date | null;
}

function fakePrisma(users: U[]) {
  const records = new Set<string>();
  const tx = {
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (records.has(data.key)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '7',
          });
        }
        records.add(data.key);
        return data;
      }),
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        records.has(where.key) ? { key: where.key } : null,
      ),
    },
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { clerkId?: string; email?: string } }) =>
          users.find((u) =>
            where.clerkId
              ? u.clerkId === where.clerkId
              : u.email === where.email,
          ) ?? null,
      ),
      create: jest.fn(
        async ({ data }: { data: Omit<U, 'id' | 'deletedAt'> }) => {
          const u = { id: `id-${users.length + 1}`, deletedAt: null, ...data };
          users.push(u);
          return u;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<U>;
        }) => {
          const u = users.find((x) => x.id === where.id)!;
          Object.assign(u, data);
          return u;
        },
      ),
    },
    deviceToken: { deleteMany: jest.fn(async () => ({ count: 2 })) },
  };
  const prisma = {
    ...tx,
    // Interactive transaction: roll back the idempotency record on failure.
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const before = new Set(records);
      try {
        return await fn(tx);
      } catch (e) {
        records.clear();
        before.forEach((k) => records.add(k));
        throw e;
      }
    }),
  };
  return { prisma, tx, users };
}

const userJson = (id: string, email: string, first = 'Ana') => ({
  id,
  first_name: first,
  last_name: 'Lima',
  primary_email_address_id: 'e1',
  email_addresses: [{ id: 'e1', email_address: email }],
});

describe('ClerkWebhookService', () => {
  it('syncs email + displayName on user.updated and ignores role', async () => {
    const { prisma, users } = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'old@x.com',
        displayName: 'Old',
        deletedAt: null,
      },
    ]);
    const svc = new ClerkWebhookService(prisma as never);
    const res = await svc.handle('msg_1', {
      type: 'user.updated',
      data: {
        ...userJson('user_1', 'new@x.com'),
        public_metadata: { role: 'ADMIN' },
      },
    });
    expect(res.action).toBe('user_updated');
    expect(users[0]).toMatchObject({
      email: 'new@x.com',
      displayName: 'Ana Lima',
    });
    expect(users[0]).not.toHaveProperty('role');
  });

  it('is idempotent per svix delivery id', async () => {
    const { prisma, tx } = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'old@x.com',
        displayName: 'Old',
        deletedAt: null,
      },
    ]);
    const svc = new ClerkWebhookService(prisma as never);
    await svc.handle('msg_1', {
      type: 'user.updated',
      data: userJson('user_1', 'a@x.com'),
    });
    const again = await svc.handle('msg_1', {
      type: 'user.updated',
      data: userJson('user_1', 'b@x.com'),
    });
    expect(again).toEqual({
      received: true,
      duplicate: true,
      action: 'duplicate',
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('does not steal an email that belongs to another account', async () => {
    const { prisma, users } = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'mine@x.com',
        displayName: 'Old',
        deletedAt: null,
      },
      {
        id: 'u2',
        clerkId: 'user_2',
        email: 'taken@x.com',
        displayName: 'Other',
        deletedAt: null,
      },
    ]);
    const svc = new ClerkWebhookService(prisma as never);
    await svc.handle('msg_2', {
      type: 'user.updated',
      data: userJson('user_1', 'taken@x.com', 'Bea'),
    });
    expect(users[0]).toMatchObject({
      email: 'mine@x.com',
      displayName: 'Bea Lima',
    });
  });

  it('provisions on user.created, ignores user.updated for unknown users', async () => {
    const { prisma, users } = fakePrisma([]);
    const svc = new ClerkWebhookService(prisma as never);
    expect(
      (
        await svc.handle('m1', {
          type: 'user.updated',
          data: userJson('user_9', 'z@x.com'),
        })
      ).action,
    ).toBe('ignored');
    expect(
      (
        await svc.handle('m2', {
          type: 'user.created',
          data: userJson('user_9', 'z@x.com'),
        })
      ).action,
    ).toBe('user_created');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ clerkId: 'user_9', email: 'z@x.com' });
  });

  it('soft-deletes on user.deleted and drops push tokens', async () => {
    const { prisma, tx, users } = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'a@x.com',
        displayName: 'A',
        deletedAt: null,
      },
    ]);
    const svc = new ClerkWebhookService(prisma as never);
    const res = await svc.handle('m3', {
      type: 'user.deleted',
      data: { id: 'user_1', deleted: true },
    });
    expect(res.action).toBe('user_deleted');
    expect(users[0].deletedAt).toBeInstanceOf(Date);
    expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });

  it('only logs session events', async () => {
    const { prisma, tx } = fakePrisma([]);
    const svc = new ClerkWebhookService(prisma as never);
    for (const type of [
      'session.removed',
      'session.ended',
      'session.revoked',
    ]) {
      expect(
        (
          await svc.handle(`s-${type}`, {
            type,
            data: { id: 'sess', user_id: 'user_1' },
          })
        ).action,
      ).toBe('session_logged');
    }
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rolls back the idempotency record when handling fails, so retries work', async () => {
    const { prisma, tx } = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'a@x.com',
        displayName: 'A',
        deletedAt: null,
      },
    ]);
    tx.user.update.mockRejectedValueOnce(new Error('db down'));
    const svc = new ClerkWebhookService(prisma as never);
    await expect(
      svc.handle('m4', { type: 'user.deleted', data: { id: 'user_1' } }),
    ).rejects.toThrow('db down');
    expect(
      (await svc.handle('m4', { type: 'user.deleted', data: { id: 'user_1' } }))
        .action,
    ).toBe('user_deleted');
  });
});
