import { Prisma } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import {
  AuthMiddleware,
  LAST_SEEN_INTERVAL_MS,
  parseStubToken,
} from './auth.middleware.js';
import type { ClerkService } from './clerk.service.js';

const DB = 'postgres://x';

interface Row {
  id: string;
  clerkId: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
  displayName: string;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
}

function fakePrisma(rows: Row[] = []) {
  const unique = () =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '7',
    });
  const prisma = {
    rows,
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { clerkId?: string; email?: string } }) =>
          rows.find((r) =>
            where.clerkId
              ? r.clerkId === where.clerkId
              : r.email === where.email,
          ) ?? null,
      ),
      create: jest.fn(
        async ({ data }: { data: Omit<Row, 'id' | 'deletedAt'> }) => {
          if (
            rows.some(
              (r) => r.email === data.email || r.clerkId === data.clerkId,
            )
          )
            throw unique();
          const row: Row = {
            id: `id-${rows.length + 1}`,
            deletedAt: null,
            ...data,
          } as Row;
          rows.push(row);
          return row;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Row>;
        }) => {
          const r = rows.find((x) => x.id === where.id)!;
          Object.assign(r, data);
          return r;
        },
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  return prisma;
}

function clerkStub(over: Partial<ClerkService> = {}): ClerkService {
  return {
    verify: jest.fn(async () => null),
    fetchProfile: jest.fn(async () => null),
    ...over,
  } as unknown as ClerkService;
}

const cfg = (env: Record<string, string> = {}) =>
  new AppConfigService(parseEnv({ DATABASE_URL: DB, ...env }));

describe('parseStubToken', () => {
  it('parses role and numbered-student tokens', () => {
    expect(parseStubToken('dev-token-admin')?.role).toBe('ADMIN');
    expect(parseStubToken('dev-token-student7')).toMatchObject({
      clerkId: 'dev-student7',
      role: 'STUDENT',
    });
    expect(parseStubToken('dev-token-root')).toBeNull();
    expect(parseStubToken('eyJhbGciOi')).toBeNull();
  });
});

describe('AuthMiddleware', () => {
  it('rejects dev tokens unless ALLOW_DEV_AUTH=true', async () => {
    const prisma = fakePrisma();
    const mw = new AuthMiddleware(prisma as never, cfg(), clerkStub());
    expect(await mw.resolve('dev-token-admin')).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects dev tokens in production even with ALLOW_DEV_AUTH', async () => {
    const prod = new AppConfigService({
      ...parseEnv({ DATABASE_URL: DB }),
      NODE_ENV: 'production',
      ALLOW_DEV_AUTH: true,
    });
    const mw = new AuthMiddleware(fakePrisma() as never, prod, clerkStub());
    expect(await mw.resolve('dev-token-admin')).toBeNull();
  });

  it('provisions dev users with their stub role when enabled', async () => {
    const prisma = fakePrisma();
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ ALLOW_DEV_AUTH: 'true' }),
      clerkStub(),
    );
    const user = await mw.resolve('dev-token-teacher');
    expect(user).toMatchObject({
      clerkId: 'dev-teacher',
      role: 'TEACHER',
      email: 'teacher@codify.local',
    });
  });

  it('provisions a first-seen Clerk subject as STUDENT with the Clerk profile', async () => {
    const prisma = fakePrisma();
    const clerk = clerkStub({
      verify: jest.fn(async () => ({
        sub: 'user_1',
        claims: { role: 'ADMIN', sub: 'user_1' },
      })),
      fetchProfile: jest.fn(async () => ({
        email: 'ana@example.com',
        displayName: 'Ana Lima',
      })),
    });
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerk,
    );
    const user = await mw.resolve('jwt');
    expect(user).toMatchObject({
      clerkId: 'user_1',
      role: 'STUDENT',
      email: 'ana@example.com',
      displayName: 'Ana Lima',
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'STUDENT' }),
      }),
    );
  });

  it('falls back to a placeholder email when the profile lookup is unavailable', async () => {
    const prisma = fakePrisma();
    const clerk = clerkStub({
      verify: jest.fn(async () => ({ sub: 'user_X', claims: {} })),
    });
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerk,
    );
    expect((await mw.resolve('jwt'))?.email).toBe('user_x@users.clerk.invalid');
  });

  it('returns null for invalid Clerk tokens', async () => {
    const mw = new AuthMiddleware(
      fakePrisma() as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerkStub(),
    );
    expect(await mw.resolve('garbage')).toBeNull();
  });

  it('treats soft-deleted users as unauthenticated', async () => {
    const prisma = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'a@b.c',
        role: 'ADMIN',
        displayName: 'A',
        lastSeenAt: null,
        deletedAt: new Date(),
      },
    ]);
    const clerk = clerkStub({
      verify: jest.fn(async () => ({ sub: 'user_1', claims: {} })),
    });
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerk,
    );
    expect(await mw.resolve('jwt')).toBeNull();
  });

  it('keeps the DB role (never the token) for existing users', async () => {
    const prisma = fakePrisma([
      {
        id: 'u1',
        clerkId: 'user_1',
        email: 'a@b.c',
        role: 'TEACHER',
        displayName: 'A',
        lastSeenAt: new Date(),
        deletedAt: null,
      },
    ]);
    const clerk = clerkStub({
      verify: jest.fn(async () => ({
        sub: 'user_1',
        claims: { role: 'ADMIN' },
      })),
    });
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerk,
    );
    expect((await mw.resolve('jwt'))?.role).toBe('TEACHER');
  });

  it('writes lastSeenAt at most once per interval', async () => {
    const recent = new Date(Date.now() - 60_000);
    const stale = new Date(Date.now() - LAST_SEEN_INTERVAL_MS - 1000);
    const prisma = fakePrisma([
      {
        id: 'u1',
        clerkId: 'dev-admin',
        email: 'admin@codify.local',
        role: 'ADMIN',
        displayName: 'A',
        lastSeenAt: recent,
        deletedAt: null,
      },
      {
        id: 'u2',
        clerkId: 'dev-support',
        email: 'support@codify.local',
        role: 'SUPPORT',
        displayName: 'S',
        lastSeenAt: stale,
        deletedAt: null,
      },
    ]);
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ ALLOW_DEV_AUTH: 'true' }),
      clerkStub(),
    );
    await mw.resolve('dev-token-admin');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    await mw.resolve('dev-token-support');
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'u2' }) }),
    );
  });

  it('releases the email of a soft-deleted account for a new Clerk identity', async () => {
    const prisma = fakePrisma([
      {
        id: 'old',
        clerkId: 'user_old',
        email: 'ana@example.com',
        role: 'STUDENT',
        displayName: 'A',
        lastSeenAt: null,
        deletedAt: new Date(),
      },
    ]);
    const clerk = clerkStub({
      verify: jest.fn(async () => ({ sub: 'user_new', claims: {} })),
      fetchProfile: jest.fn(async () => ({
        email: 'ana@example.com',
        displayName: 'Ana',
      })),
    });
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerk,
    );
    const user = await mw.resolve('jwt');
    expect(user).toMatchObject({
      clerkId: 'user_new',
      email: 'ana@example.com',
    });
    expect(prisma.rows.find((r) => r.id === 'old')?.email).toBe(
      'deleted+old@deleted.codify.invalid',
    );
  });

  it('never re-links a live account to a different Clerk subject', async () => {
    const prisma = fakePrisma([
      {
        id: 'live',
        clerkId: 'user_live',
        email: 'ana@example.com',
        role: 'ADMIN',
        displayName: 'A',
        lastSeenAt: null,
        deletedAt: null,
      },
    ]);
    const clerk = clerkStub({
      verify: jest.fn(async () => ({ sub: 'user_other', claims: {} })),
      fetchProfile: jest.fn(async () => ({
        email: 'ana@example.com',
        displayName: 'Ana',
      })),
    });
    const mw = new AuthMiddleware(
      prisma as never,
      cfg({ CLERK_JWT_KEY: 'pem' }),
      clerk,
    );
    expect(await mw.resolve('jwt')).toBeNull();
  });

  it('use() attaches req.user and always calls next', async () => {
    const mw = new AuthMiddleware(
      fakePrisma() as never,
      cfg({ ALLOW_DEV_AUTH: 'true' }),
      clerkStub(),
    );
    const req = {
      headers: { authorization: 'Bearer dev-token-student' },
    } as never as { user?: unknown };
    const next = jest.fn();
    await mw.use(req as never, {} as never, next);
    expect(req.user).toMatchObject({ role: 'STUDENT' });
    expect(next).toHaveBeenCalled();

    const anon = { headers: {} } as { user?: unknown; headers: object };
    await mw.use(anon as never, {} as never, next);
    expect(anon.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(2);
  });
});
