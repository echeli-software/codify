import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
  FcmPushProvider,
  decodeServiceAccount,
  toFcmMessage,
} from './fcm-push.provider.js';

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(() => ({ kind: 'cert' })),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'codify-push' })),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEach: jest.fn() })),
}));

const SA = {
  project_id: 'codify',
  client_email: 'push@codify.iam',
  private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
};
const b64 = Buffer.from(JSON.stringify(SA)).toString('base64');

describe('decodeServiceAccount', () => {
  it('decodes base64 JSON (and tolerates raw JSON)', () => {
    expect(decodeServiceAccount(b64)).toMatchObject({ project_id: 'codify' });
    expect(decodeServiceAccount(JSON.stringify(SA))).toMatchObject({
      client_email: 'push@codify.iam',
    });
  });

  it('rejects garbage and incomplete accounts with a clear message', () => {
    expect(() => decodeServiceAccount('!!!')).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );
    expect(() =>
      decodeServiceAccount(
        Buffer.from('{"project_id":"x"}').toString('base64'),
      ),
    ).toThrow('private_key');
  });
});

describe('FcmPushProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('initialises a named firebase app from the service account', () => {
    const p = FcmPushProvider.fromServiceAccount(b64);
    expect(p.mode).toBe('fcm');
    expect(cert).toHaveBeenCalledWith({
      projectId: 'codify',
      clientEmail: 'push@codify.iam',
      privateKey: SA.private_key,
    });
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'codify' }),
      'codify-push',
    );
    expect(getMessaging).toHaveBeenCalled();
  });

  it('reuses an existing app', () => {
    jest
      .mocked(getApps)
      .mockReturnValueOnce([{ name: 'codify-push' } as never]);
    FcmPushProvider.fromServiceAccount(b64);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('builds messages for Android, iOS (APNs bridge) and web', () => {
    const m = toFcmMessage({
      token: 't',
      title: 'Hi',
      body: 'There',
      data: { type: 'x' },
    });
    expect(m).toMatchObject({
      token: 't',
      notification: { title: 'Hi', body: 'There' },
      data: { type: 'x' },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
      webpush: { notification: { title: 'Hi' } },
    });
  });

  it('counts results and reports only permanently invalid tokens', async () => {
    const sendEach = jest.fn().mockResolvedValue({
      successCount: 1,
      failureCount: 3,
      responses: [
        { success: true },
        {
          success: false,
          error: {
            code: 'messaging/registration-token-not-registered',
            message: 'gone',
          },
        },
        {
          success: false,
          error: {
            code: 'messaging/invalid-registration-token',
            message: 'bad',
          },
        },
        {
          success: false,
          error: { code: 'messaging/internal-error', message: 'retry' },
        },
      ],
    });
    const p = new FcmPushProvider({ sendEach });
    const res = await p.send(
      ['a', 'b', 'c', 'd'].map((token) => ({ token, title: 't', body: 'b' })),
    );
    expect(res).toEqual({ sent: 1, failed: 3, invalidTokens: ['b', 'c'] });
  });

  it('batches by 500 and prunes nothing when a batch fails wholesale', async () => {
    const sendEach = jest
      .fn()
      .mockResolvedValueOnce({
        successCount: 500,
        failureCount: 0,
        responses: Array(500).fill({ success: true }),
      })
      .mockRejectedValueOnce(new Error('auth'));
    const p = new FcmPushProvider({ sendEach });
    const msgs = Array.from({ length: 501 }, (_, i) => ({
      token: `t${i}`,
      title: 't',
      body: 'b',
    }));
    const res = await p.send(msgs);
    expect(sendEach).toHaveBeenCalledTimes(2);
    expect(sendEach.mock.calls[1][0]).toHaveLength(1);
    expect(res).toEqual({ sent: 500, failed: 1, invalidTokens: [] });
  });
});
