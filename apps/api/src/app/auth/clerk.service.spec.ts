import { createClerkClient, verifyToken } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import {
  ClerkService,
  CLERK_API_URL,
  buildDisplayName,
  isClerkUserId,
  profileFromClerkJson,
} from './clerk.service.js';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
  createClerkClient: jest.fn(() => ({ users: { getUser: jest.fn() } })),
}));
jest.mock('@clerk/backend/webhooks', () => ({ verifyWebhook: jest.fn() }));

const cfg = (env: Record<string, string> = {}) =>
  new AppConfigService(parseEnv({ DATABASE_URL: 'postgres://x', ...env }));

describe('profile helpers', () => {
  it('builds display names from name parts, username or email', () => {
    expect(buildDisplayName({ firstName: 'Ana', lastName: 'Lima' })).toBe(
      'Ana Lima',
    );
    expect(buildDisplayName({ username: 'ana_l' })).toBe('ana_l');
    expect(buildDisplayName({ email: 'ana@x.com' })).toBe('ana');
    expect(buildDisplayName({})).toBe('Learner');
    expect(buildDisplayName({ firstName: 'x'.repeat(100) })).toHaveLength(80);
  });

  it('reads the primary email from webhook JSON', () => {
    expect(
      profileFromClerkJson({
        id: 'user_1',
        primary_email_address_id: 'e2',
        email_addresses: [
          { id: 'e1', email_address: 'old@x.com' },
          { id: 'e2', email_address: 'New@X.com' },
        ],
        first_name: 'Ana',
        last_name: null,
      }),
    ).toEqual({ email: 'new@x.com', displayName: 'Ana' });
  });
});

describe('ClerkService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is disabled without keys and verifies nothing', async () => {
    const svc = new ClerkService(cfg());
    expect(svc.enabled).toBe(false);
    expect(await svc.verify('t')).toBeNull();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('verifies with the PEM key and authorized parties', async () => {
    jest
      .mocked(verifyToken)
      .mockResolvedValue({ sub: 'user_1', azp: 'https://app' } as never);
    const svc = new ClerkService(
      cfg({
        CLERK_JWT_KEY: 'PEM',
        CLERK_AUTHORIZED_PARTIES: 'https://app,https://admin',
      }),
    );
    const out = await svc.verify('jwt');
    expect(out?.sub).toBe('user_1');
    expect(verifyToken).toHaveBeenCalledWith('jwt', {
      secretKey: undefined,
      jwtKey: 'PEM',
      authorizedParties: ['https://app', 'https://admin'],
    });
  });

  it('returns null when verification throws', async () => {
    jest.mocked(verifyToken).mockRejectedValue(new Error('expired'));
    const svc = new ClerkService(cfg({ CLERK_SECRET_KEY: 'sk' }));
    expect(await svc.verify('jwt')).toBeNull();
  });

  it('fetches the profile from the Backend API', async () => {
    const getUser = jest.fn().mockResolvedValue({
      primaryEmailAddress: { emailAddress: 'Ana@Example.com' },
      emailAddresses: [],
      firstName: 'Ana',
      lastName: 'Lima',
      username: null,
    });
    jest
      .mocked(createClerkClient)
      .mockReturnValue({ users: { getUser } } as never);
    const svc = new ClerkService(cfg({ CLERK_SECRET_KEY: 'sk' }));
    expect(await svc.fetchProfile('user_1')).toEqual({
      email: 'ana@example.com',
      displayName: 'Ana Lima',
    });
    expect(getUser).toHaveBeenCalledWith('user_1');
  });

  it('returns null from fetchProfile without a secret key or on failure', async () => {
    expect(
      await new ClerkService(cfg({ CLERK_JWT_KEY: 'PEM' })).fetchProfile('u'),
    ).toBeNull();
    jest.mocked(createClerkClient).mockReturnValue({
      users: { getUser: jest.fn().mockRejectedValue(new Error('404')) },
    } as never);
    expect(
      await new ClerkService(cfg({ CLERK_SECRET_KEY: 'sk' })).fetchProfile('u'),
    ).toBeNull();
  });

  it('verifies webhooks against the raw body with the signing secret', async () => {
    jest.mocked(verifyWebhook).mockResolvedValue({
      type: 'user.deleted',
      data: { id: 'user_1' },
    } as never);
    const svc = new ClerkService(
      cfg({ CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_abc' }),
    );
    const evt = await svc.verifyWebhook(Buffer.from('{"a":1}'), {
      'svix-id': 'msg_1',
      'svix-timestamp': '1',
      'svix-signature': 'v1,sig',
    });
    expect(evt).toEqual({ type: 'user.deleted', data: { id: 'user_1' } });
    const [request, options] = jest.mocked(verifyWebhook).mock.calls[0];
    expect(options).toEqual({ signingSecret: 'whsec_abc' });
    expect(request.headers.get('svix-id')).toBe('msg_1');
    expect(await request.text()).toBe('{"a":1}');
  });

  it('refuses webhooks when no signing secret is configured', async () => {
    const svc = new ClerkService(cfg());
    expect(svc.webhooksEnabled).toBe(false);
    await expect(svc.verifyWebhook('{}', {})).rejects.toThrow(
      'CLERK_WEBHOOK_SIGNING_SECRET',
    );
  });

  it('fails module init in production without Clerk', () => {
    const prod = new AppConfigService({
      ...parseEnv({ DATABASE_URL: 'postgres://x' }),
      NODE_ENV: 'production',
    });
    expect(() => new ClerkService(prod).onModuleInit()).toThrow(
      'CLERK_SECRET_KEY',
    );
  });
});

describe('ClerkService.setBanned (HTTP mocked)', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const svc = () => new ClerkService(cfg({ CLERK_SECRET_KEY: 'sk_test_x' }));

  it('recognises Clerk user ids only', () => {
    expect(isClerkUserId('user_2abcDEF')).toBe(true);
    expect(isClerkUserId('dev-student')).toBe(false);
    expect(isClerkUserId('purged-123')).toBe(false);
    expect(isClerkUserId(null)).toBe(false);
  });

  it('POSTs /v1/users/{id}/ban and /unban with the secret key', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(svc().setBanned('user_abc', true)).resolves.toEqual({
      status: 'synced',
    });
    await expect(svc().setBanned('user_abc', false)).resolves.toEqual({
      status: 'synced',
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${CLERK_API_URL}/v1/users/user_abc/ban`,
      `${CLERK_API_URL}/v1/users/user_abc/unban`,
    ]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk_test_x',
    );
  });

  it('reports HTTP and network failures without throwing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"errors":[{"code":"resource_not_found"}]}', {
        status: 404,
      }),
    );
    const res = await svc().setBanned('user_abc', true);
    expect(res).toMatchObject({ status: 'failed' });
    expect((res as { error: string }).error).toContain('HTTP 404');
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(svc().setBanned('user_abc', false)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('ECONNRESET'),
    });
  });

  it('skips without a secret key or a Clerk id (dev tokens)', async () => {
    await expect(
      new ClerkService(cfg()).setBanned('user_abc', true),
    ).resolves.toEqual({ status: 'skipped', reason: 'not_configured' });
    await expect(svc().setBanned('dev-student', true)).resolves.toEqual({
      status: 'skipped',
      reason: 'no_clerk_id',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ClerkService.deleteUser (HTTP mocked)', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const svc = () => new ClerkService(cfg({ CLERK_SECRET_KEY: 'sk_test_x' }));

  it('DELETEs /v1/users/{id}; a 404 (already gone) counts as done', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(svc().deleteUser('user_abc')).resolves.toEqual({
      status: 'synced',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CLERK_API_URL}/v1/users/user_abc`);
    expect(init.method).toBe('DELETE');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(svc().deleteUser('user_abc')).resolves.toEqual({
      status: 'synced',
    });
  });

  it('reports failures without throwing, and skips when it cannot call', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(svc().deleteUser('user_abc')).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('HTTP 500'),
    });
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(svc().deleteUser('user_abc')).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('ECONNRESET'),
    });
    fetchMock.mockClear();
    await expect(
      new ClerkService(cfg()).deleteUser('user_abc'),
    ).resolves.toEqual({ status: 'skipped', reason: 'not_configured' });
    await expect(svc().deleteUser('purged:1')).resolves.toEqual({
      status: 'skipped',
      reason: 'no_clerk_id',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
