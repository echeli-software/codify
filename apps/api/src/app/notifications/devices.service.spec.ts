import { ConflictException } from '@nestjs/common';
import { DevicesService } from './devices.service.js';

interface Tok {
  id: string;
  userId: string;
  token: string;
  platform: string;
}

function fakePrisma(rows: Tok[]) {
  return {
    rows,
    deviceToken: {
      findUnique: jest.fn(
        async ({ where }: { where: { token: string } }) =>
          rows.find((r) => r.token === where.token) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Tok>;
        }) => {
          const r = rows.find((x) => x.id === where.id)!;
          Object.assign(r, data);
          return { id: r.id };
        },
      ),
      create: jest.fn(async ({ data }: { data: Omit<Tok, 'id'> }) => {
        const r = { id: `d${rows.length + 1}`, ...data };
        rows.push(r);
        return { id: r.id };
      }),
      deleteMany: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; userId?: string; token?: string };
        }) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            if (
              (where.id === undefined || r.id === where.id) &&
              (where.userId === undefined || r.userId === where.userId) &&
              (where.token === undefined || r.token === where.token)
            ) {
              rows.splice(i, 1);
            }
          }
          return { count: before - rows.length };
        },
      ),
    },
  };
}

describe('DevicesService.register', () => {
  it('creates a new binding', async () => {
    const prisma = fakePrisma([]);
    const svc = new DevicesService(prisma as never);
    expect(await svc.register('u1', 'tok', 'IOS')).toEqual({ id: 'd1' });
    expect(prisma.rows).toEqual([
      { id: 'd1', userId: 'u1', token: 'tok', platform: 'IOS' },
    ]);
  });

  it('refreshes the binding for the same user', async () => {
    const prisma = fakePrisma([
      { id: 'd1', userId: 'u1', token: 'tok', platform: 'IOS' },
    ]);
    const svc = new DevicesService(prisma as never);
    expect(await svc.register('u1', 'tok', 'ANDROID')).toEqual({ id: 'd1' });
    expect(prisma.rows[0].platform).toBe('ANDROID');
  });

  it('never silently moves a token to another user: unbinds, 409, then binds on re-register', async () => {
    const prisma = fakePrisma([
      { id: 'd1', userId: 'victim', token: 'tok', platform: 'IOS' },
    ]);
    const svc = new DevicesService(prisma as never);
    await expect(svc.register('other', 'tok', 'IOS')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.rows).toHaveLength(0); // victim's binding removed, nothing bound to "other" yet
    expect(prisma.deviceToken.update).not.toHaveBeenCalled();
    await expect(svc.register('other', 'tok', 'IOS')).resolves.toEqual({
      id: 'd1',
    });
    expect(prisma.rows[0].userId).toBe('other');
  });

  it('unregister only removes the caller’s own token', async () => {
    const prisma = fakePrisma([
      { id: 'd1', userId: 'u1', token: 'tok', platform: 'IOS' },
    ]);
    const svc = new DevicesService(prisma as never);
    expect(await svc.unregister('u2', 'tok')).toEqual({ removed: 0 });
    expect(await svc.unregister('u1', 'tok')).toEqual({ removed: 1 });
  });
});
