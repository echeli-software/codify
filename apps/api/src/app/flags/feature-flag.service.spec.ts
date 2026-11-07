import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_FLAGS,
  FLAG_CACHE_TTL_MS,
  FeatureFlagService,
} from './feature-flag.service.js';
import { FeatureGuard } from './feature.guard.js';

interface Row {
  key: string;
  value: unknown;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function fakePrisma(initial: Partial<Row>[] = []) {
  const rows: Row[] = initial.map((r) => ({
    description: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    value: { enabled: true },
    key: 'x',
    ...r,
  }));
  const featureFlag = {
    findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
    findUnique: jest.fn(
      async ({ where }: { where: { key: string } }) =>
        rows.find((r) => r.key === where.key) ?? null,
    ),
    createMany: jest.fn(
      async ({ data }: { data: Row[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const d of data) {
          if (rows.some((r) => r.key === d.key)) continue;
          rows.push({
            ...d,
            isActive: d.isActive ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Row);
          count += 1;
        }
        return { count };
      },
    ),
    create: jest.fn(
      async ({ data }: { data: Omit<Row, 'createdAt' | 'updatedAt'> }) => {
        if (rows.some((r) => r.key === data.key))
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 't',
          });
        const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { key: string };
        data: Partial<Row>;
      }) => {
        const r = rows.find((x) => x.key === where.key)!;
        Object.assign(r, data, { updatedAt: new Date() });
        return r;
      },
    ),
    delete: jest.fn(async ({ where }: { where: { key: string } }) => {
      const i = rows.findIndex((x) => x.key === where.key);
      return rows.splice(i, 1)[0];
    }),
  };
  return { rows, featureFlag };
}

describe('FeatureFlagService', () => {
  it('seeds missing built-in flags without overwriting existing ones', async () => {
    const prisma = fakePrisma([
      { key: 'shop.enabled', value: { enabled: false } },
    ]);
    const svc = new FeatureFlagService(prisma as never);
    expect(await svc.ensureDefaults()).toBe(DEFAULT_FLAGS.length - 1);
    expect(await svc.ensureDefaults()).toBe(0);
    expect(prisma.rows.find((r) => r.key === 'shop.enabled')?.value).toEqual({
      enabled: false,
    });
    expect(await svc.isEnabled('shop.enabled', 'u1')).toBe(false);
    expect(await svc.isEnabled('leagues.enabled', 'u1')).toBe(true);
  });

  it('a missing built-in row evaluates as its default; unknown keys are off', async () => {
    const svc = new FeatureFlagService(fakePrisma() as never);
    expect(await svc.isEnabled('leagues.enabled', 'u1')).toBe(true);
    expect(await svc.evaluate('nope', 'u1')).toEqual({
      enabled: false,
      variant: null,
    });
  });

  it('caches reads for the TTL and invalidates on admin writes', async () => {
    const prisma = fakePrisma([{ key: 'exp.a', value: { enabled: true } }]);
    const svc = new FeatureFlagService(prisma as never);
    let t = 1_000_000;
    svc.now = () => t;
    await svc.evaluate('exp.a', 'u');
    await svc.evaluate('exp.a', 'u');
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(1);

    await svc.update('exp.a', { value: { enabled: false } });
    expect(await svc.isEnabled('exp.a', 'u')).toBe(false);
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(2);

    // Out-of-band DB change: visible once the TTL lapses.
    prisma.rows[0].value = { enabled: true };
    expect(await svc.isEnabled('exp.a', 'u')).toBe(false);
    t += FLAG_CACHE_TTL_MS + 1;
    expect(await svc.isEnabled('exp.a', 'u')).toBe(true);
  });

  it('evaluateAll: anonymous callers only get public-surface flags', async () => {
    const prisma = fakePrisma([
      { key: 'landing.hero', value: { enabled: true, surface: 'public' } },
      { key: 'exp.secret', value: { enabled: true, surface: 'student' } },
    ]);
    const svc = new FeatureFlagService(prisma as never);
    expect(Object.keys(await svc.evaluateAll(null))).toEqual(['landing.hero']);
    const mine = await svc.evaluateAll('u1');
    expect(Object.keys(mine)).toEqual(
      expect.arrayContaining([
        'landing.hero',
        'exp.secret',
        'leagues.enabled',
        'shop.enabled',
      ]),
    );
  });

  it('validates create/update input and protects built-ins from deletion', async () => {
    const svc = new FeatureFlagService(fakePrisma() as never);
    await expect(
      svc.create('Bad Key', { value: { enabled: true } }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_FLAG' } });
    await expect(
      svc.create('exp.b', { value: { enabled: true, rolloutPct: 200 } }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_FLAG' } });
    const created = await svc.create('exp.b', {
      value: { enabled: true, variants: { a: 1, b: 1 } },
      description: 'B test',
    });
    expect(created).toMatchObject({ key: 'exp.b', builtIn: false });
    await expect(
      svc.create('exp.b', { value: { enabled: true } }),
    ).rejects.toMatchObject({ response: { code: 'FLAG_EXISTS' } });
    await expect(svc.remove('shop.enabled')).rejects.toMatchObject({
      response: { code: 'FLAG_BUILT_IN' },
    });
    await expect(svc.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await svc.remove('exp.b')).key).toBe('exp.b');
  });

  it('treats a stored invalid value as disabled', async () => {
    const svc = new FeatureFlagService(
      fakePrisma([{ key: 'exp.broken', value: { enabled: 'yes' } }]) as never,
    );
    expect(await svc.isEnabled('exp.broken', 'u')).toBe(false);
  });
});

describe('FeatureGuard', () => {
  const ctx = (userId?: string) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: userId ? { userId } : undefined }),
      }),
    }) as never;

  it('404 FEATURE_DISABLED when the flag is off; passes otherwise', async () => {
    const prisma = fakePrisma([
      { key: 'shop.enabled', value: { enabled: false } },
    ]);
    const flags = new FeatureFlagService(prisma as never);
    const reflector = { getAllAndOverride: jest.fn(() => 'shop.enabled') };
    const guard = new FeatureGuard(reflector as never, flags);
    await expect(guard.canActivate(ctx('u1'))).rejects.toMatchObject({
      status: 404,
      response: { code: 'FEATURE_DISABLED', feature: 'shop.enabled' },
    });
    reflector.getAllAndOverride.mockReturnValue('leagues.enabled');
    await expect(guard.canActivate(ctx('u1'))).resolves.toBe(true);
    reflector.getAllAndOverride.mockReturnValue(undefined as never);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });
});
