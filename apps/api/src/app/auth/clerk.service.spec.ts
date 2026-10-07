import { createClerkClient, verifyToken } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import {
  ClerkService,
  buildDisplayName,
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
