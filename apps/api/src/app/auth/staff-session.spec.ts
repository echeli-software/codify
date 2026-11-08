import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import type { ClerkService } from './clerk.service.js';
import { AuthMiddleware } from './auth.middleware.js';
import {
  DEFAULT_STAFF_SESSION_POLICY,
  staffSessionBlockFor,
  staffSessionPolicyFromEnv,
} from './staff-session.js';

const P = DEFAULT_STAFF_SESSION_POLICY;
const block = (
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN',
  claims: Record<string, unknown> | undefined,
  path = '/api/admin/users',
  method = 'GET',
) => staffSessionBlockFor(role, claims, method, path, P)?.code ?? null;

describe('staffSessionBlockFor', () => {
  it('requires a second factor for ADMIN and SUPPORT, not for TEACHER / STUDENT', () => {
    const noMfa = { fva: [5, -1] };
    expect(block('ADMIN', noMfa)).toBe('MFA_REQUIRED');
    expect(block('SUPPORT', noMfa)).toBe('MFA_REQUIRED');
    expect(block('TEACHER', noMfa)).toBeNull();
    expect(block('STUDENT', noMfa)).toBeNull();
    expect(block('ADMIN', { fva: [5, 5] })).toBeNull();
  });

  it('fails closed when the token has no fva claim', () => {
    expect(block('ADMIN', {})).toBe('MFA_REQUIRED');
    expect(block('ADMIN', { fva: 'x' })).toBe('MFA_REQUIRED');
  });

  it('enforces the 12 h absolute session age (minutes since first factor)', () => {
    expect(block('ADMIN', { fva: [720, 700] })).toBeNull();
    expect(block('ADMIN', { fva: [721, 3] })).toBe('SESSION_TOO_OLD');
    expect(block('ADMIN', { fva: [-1, 3] })).toBe('SESSION_TOO_OLD');
  });

  it('exempts dev tokens (no claims) and GET /me + account-status', () => {
    expect(block('ADMIN', undefined)).toBeNull();
    expect(block('ADMIN', {}, '/api/me')).toBeNull();
    expect(block('ADMIN', {}, '/api/me/account-status')).toBeNull();
    expect(block('ADMIN', {}, '/api/me', 'PATCH')).toBe('MFA_REQUIRED');
    expect(block('ADMIN', {}, '/api/me/export')).toBe('MFA_REQUIRED');
  });

  it('carries the limit in the problem body', () => {
    expect(
      staffSessionBlockFor('ADMIN', { fva: [800, 1] }, 'GET', '/api/x', P),
    ).toMatchObject({ code: 'SESSION_TOO_OLD', maxSessionHours: 12 });
  });
});

describe('staffSessionPolicyFromEnv', () => {
  it('defaults to ADMIN + SUPPORT, 12 h; parses overrides; "none" disables', () => {
    expect(staffSessionPolicyFromEnv({})).toEqual(P);
    expect(
      staffSessionPolicyFromEnv({
        STAFF_MFA_ROLES: 'admin, teacher, bogus',
        STAFF_SESSION_MAX_HOURS: 8,
      }),
    ).toEqual({ roles: ['ADMIN', 'TEACHER'], maxAgeMinutes: 480 });
    expect(
      staffSessionPolicyFromEnv({ STAFF_MFA_ROLES: 'none' }).roles,
    ).toEqual([]);
  });

  it('is validated by the env schema', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x',
      STAFF_MFA_ROLES: 'ADMIN',
      STAFF_SESSION_MAX_HOURS: '6',
    });
    expect(env.STAFF_SESSION_MAX_HOURS).toBe(6);
    expect(() =>
      parseEnv({ DATABASE_URL: 'postgres://x', STAFF_SESSION_MAX_HOURS: '-1' }),
    ).toThrow(/STAFF_SESSION_MAX_HOURS/);
  });
});

describe('AuthMiddleware staff session enforcement', () => {
  const admin = {
    id: 'a1',
    clerkId: 'user_admin',
    email: 'a@x.dev',
    role: 'ADMIN' as const,
    displayName: 'A',
    lastSeenAt: new Date(),
    deletedAt: null,
    deletionRequestedAt: null,
    purgedAt: null,
    suspendedAt: null,
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => admin),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const mw = (fva: unknown, env: Record<string, string> = {}) =>
    new AuthMiddleware(
      prisma as never,
      new AppConfigService(parseEnv({ DATABASE_URL: 'postgres://x', ...env })),
      {
        verify: jest.fn(async () => ({
          sub: 'user_admin',
          claims: fva === undefined ? {} : { fva },
        })),
        fetchProfile: jest.fn(async () => null),
      } as unknown as ClerkService,
    );
  const call = async (m: AuthMiddleware, url: string, method = 'GET') => {
    const req = {
      method,
      originalUrl: url,
      headers: { authorization: 'Bearer jwt' },
    } as { user?: unknown };
    const next = jest.fn();
    try {
      await m.use(req as never, {} as never, next);
      return { ok: next.mock.calls.length === 1, user: req.user, code: null };
    } catch (e) {
      return {
        ok: false,
        user: req.user,
        code: (e as { response: { code: string } }).response.code,
        status: (e as { status: number }).status,
      };
    }
  };

  it('403 MFA_REQUIRED / SESSION_TOO_OLD for an ADMIN Clerk session, GET /me still works', async () => {
    expect(await call(mw([3, -1]), '/api/admin/users')).toMatchObject({
      ok: false,
      code: 'MFA_REQUIRED',
      status: 403,
      user: undefined,
    });
    expect(await call(mw([900, 2]), '/api/admin/users')).toMatchObject({
      ok: false,
      code: 'SESSION_TOO_OLD',
    });
    expect(await call(mw([3, -1]), '/api/me')).toMatchObject({ ok: true });
    expect(await call(mw([3, 2]), '/api/admin/users')).toMatchObject({
      ok: true,
      user: { role: 'ADMIN' },
    });
  });

  it('STAFF_MFA_ROLES=none disables the check', async () => {
    expect(
      await call(mw([3, -1], { STAFF_MFA_ROLES: 'none' }), '/api/admin/users'),
    ).toMatchObject({ ok: true });
  });
});
