import { Logger } from '@nestjs/common';
import webpush from 'web-push';
import {
  WEB_PUSH_TTL_SECONDS,
  WebPushProvider,
  createWebPushProvider,
  toWebPushPayload,
  type WebPushSender,
} from './web-push.provider.js';

// A throwaway key pair generated for these tests only.
const KEYS = webpush.generateVAPIDKeys();
const VAPID = {
  publicKey: KEYS.publicKey,
  privateKey: KEYS.privateKey,
  subject: 'mailto:ops@codify.test',
};

const target = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/sub-${n}`,
  p256dh: `p256dh-${n}`,
  auth: `auth-${n}`,
});

function sender(
  fail: Record<string, number | 'network'> = {},
): WebPushSender & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    sendNotification: jest.fn(async (sub, payload, options) => {
      calls.push([sub, payload, options]);
      const f = fail[sub.endpoint];
      if (f === 'network') throw new Error('ECONNRESET');
      if (typeof f === 'number') {
        throw Object.assign(new Error(`status ${f}`), { statusCode: f });
      }
      return { statusCode: 201 };
    }),
  };
}

describe('toWebPushPayload (Angular service worker format)', () => {
  it('builds the ngsw notification with a tap that opens the deep link', () => {
    const payload = JSON.parse(
      toWebPushPayload({
        title: '🔥 Keep your streak alive!',
        body: 'Do a lesson today',
        data: { url: '/today', kind: 'STREAK_REMINDER', notificationId: 'n1' },
      }),
    );
    expect(payload).toEqual({
      notification: {
        title: '🔥 Keep your streak alive!',
        body: 'Do a lesson today',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        tag: 'n1',
        data: {
          url: '/today',
          kind: 'STREAK_REMINDER',
          notificationId: 'n1',
          onActionClick: {
            default: { operation: 'navigateLastFocusedOrOpen', url: '/today' },
          },
        },
      },
    });
  });

  it('only ever opens app-relative paths', () => {
    for (const url of ['https://evil.example/x', '//evil.example', 'x']) {
      const p = JSON.parse(
        toWebPushPayload({ title: 't', body: 'b', data: { url } }),
      );
      expect(p.notification.data.onActionClick.default.url).toBe('/');
    }
  });
});

describe('WebPushProvider', () => {
  it('sends one encrypted request per subscription with the VAPID details', async () => {
    const s = sender();
    const provider = new WebPushProvider(VAPID, s);
    const res = await provider.send([target(1), target(2)], {
      title: 'T',
      body: 'B',
      data: { url: '/league' },
    });
    expect(res).toEqual({ sent: 2, failed: 0, expiredEndpoints: [] });
    expect(s.calls[0][0]).toEqual({
      endpoint: target(1).endpoint,
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
    });
    expect(JSON.parse(s.calls[0][1] as string).notification.title).toBe('T');
    expect(s.calls[0][2]).toMatchObject({
      vapidDetails: VAPID,
      TTL: WEB_PUSH_TTL_SECONDS,
      urgency: 'normal',
    });
  });

  it('reports 404 / 410 subscriptions as expired; other errors as failures', async () => {
    const s = sender({
      [target(1).endpoint]: 410,
      [target(2).endpoint]: 404,
      [target(3).endpoint]: 500,
      [target(4).endpoint]: 'network',
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const provider = new WebPushProvider(VAPID, s);
    const res = await provider.send(
      [target(1), target(2), target(3), target(4), target(5)],
      { title: 'T', body: 'B' },
    );
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(4);
    expect(res.expiredEndpoints.sort()).toEqual(
      [target(1).endpoint, target(2).endpoint].sort(),
    );
    // Two non-expiry errors in the same minute → one log line, no endpoint.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('fcm.googleapis.com');
    warn.mockRestore();
  });

  it('is a no-op when VAPID is not configured', async () => {
    const s = sender();
    const provider = new WebPushProvider(null, s);
    expect(provider.enabled).toBe(false);
    expect(provider.publicKey).toBeNull();
    expect(await provider.send([target(1)], { title: 'T', body: 'B' })).toEqual(
      { sent: 0, failed: 0, expiredEndpoints: [] },
    );
    expect(s.sendNotification).not.toHaveBeenCalled();
  });
});

describe('createWebPushProvider', () => {
  const env = (over: Record<string, string>) =>
    ({ NODE_ENV: 'development', ...over }) as NodeJS.ProcessEnv;

  it('is off without VAPID keys outside production', () => {
    const p = createWebPushProvider(env({}));
    expect(p.enabled).toBe(false);
  });

  it('is on with all three variables', () => {
    const p = createWebPushProvider(
      env({
        VAPID_PUBLIC_KEY: VAPID.publicKey,
        VAPID_PRIVATE_KEY: VAPID.privateKey,
        VAPID_SUBJECT: VAPID.subject,
      }),
    );
    expect(p.enabled).toBe(true);
    expect(p.publicKey).toBe(VAPID.publicKey);
  });

  it('refuses a partial configuration, a bad subject or a bad key', () => {
    expect(() =>
      createWebPushProvider(env({ VAPID_PUBLIC_KEY: VAPID.publicKey })),
    ).toThrow('VAPID_PRIVATE_KEY, VAPID_SUBJECT are required');
    expect(() =>
      createWebPushProvider(
        env({
          VAPID_PUBLIC_KEY: VAPID.publicKey,
          VAPID_PRIVATE_KEY: VAPID.privateKey,
          VAPID_SUBJECT: 'ops@codify.test',
        }),
      ),
    ).toThrow('VAPID_SUBJECT');
    expect(() =>
      createWebPushProvider(
        env({
          VAPID_PUBLIC_KEY: 'not-a-key',
          VAPID_PRIVATE_KEY: VAPID.privateKey,
          VAPID_SUBJECT: VAPID.subject,
        }),
      ),
    ).toThrow();
  });

  it('refuses to boot in production without the keys', () => {
    expect(() =>
      createWebPushProvider({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(
      'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT are required in production',
    );
  });
});
