import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebPushController } from './web-push.controller.js';
import { WebPushProvider } from './web-push.provider.js';
import {
  WebPushSubscriptionsService,
  isAllowedPushEndpoint,
} from './web-push-subscriptions.service.js';

interface Row {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  lastSeenAt: Date;
}

function fakeDb() {
  const rows: Row[] = [];
  let seq = 0;
  return {
    rows,
    webPushSubscription: {
      findUnique: jest.fn(
        async ({ where }: { where: { endpoint: string } }) =>
          rows.find((r) => r.endpoint === where.endpoint) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Row>;
        }) => {
          const r = rows.find((x) => x.id === where.id);
          if (!r) throw new Error('not found');
          Object.assign(r, data);
          return { id: r.id };
        },
      ),
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
        const r = { ...data, id: `w${++seq}` };
        rows.push(r);
        return { id: r.id };
      }),
      deleteMany: jest.fn(
        async ({ where }: { where: { endpoint: string; userId: string } }) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--)
            if (
              rows[i].endpoint === where.endpoint &&
              rows[i].userId === where.userId
            )
              rows.splice(i, 1);
          return { count: before - rows.length };
        },
      ),
    },
  };
}

const EP = 'https://fcm.googleapis.com/fcm/send/abc:def';
const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
const actor = (userId: string) => ({ userId, role: 'STUDENT' }) as never;
const req = { headers: { 'user-agent': 'Chrome/130' } } as never;

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QF-x',
    'https://db5p.notify.windows.com/w/?token=x',
  ])('accepts %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://push.apple.com/x',
    'not a url',
  ])('refuses %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(false));
});

describe('WebPushController + WebPushSubscriptionsService', () => {
  function setup(enabled = true) {
    const db = fakeDb();
    const service = new WebPushSubscriptionsService(db as never);
    const provider = new WebPushProvider(
      enabled
        ? { publicKey: 'BPub', privateKey: 'priv', subject: 'mailto:x@y.z' }
        : null,
    );
    return { db, ctrl: new WebPushController(service, provider) };
  }

  it('GET config returns the public key, or 404 WEB_PUSH_DISABLED', () => {
    expect(setup().ctrl.config()).toEqual({ publicKey: 'BPub' });
    expect(() => setup(false).ctrl.config()).toThrow(NotFoundException);
    try {
      setup(false).ctrl.config();
    } catch (e) {
      expect((e as NotFoundException).getResponse()).toMatchObject({
        code: 'WEB_PUSH_DISABLED',
      });
    }
  });

  it('POST upserts by endpoint and re-owns it to the caller', async () => {
    const { db, ctrl } = setup();
    const a = await ctrl.subscribe(actor('u1'), { endpoint: EP, keys }, req);
    expect(db.rows).toEqual([
      expect.objectContaining({
        id: a.id,
        userId: 'u1',
        endpoint: EP,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: 'Chrome/130',
      }),
    ]);
    // Same browser, new keys: same row, updated.
    const again = await ctrl.subscribe(
      actor('u1'),
      { endpoint: EP, keys: { ...keys, auth: 'b'.repeat(22) } },
      req,
    );
    expect(again.id).toBe(a.id);
    expect(db.rows[0].auth).toBe('b'.repeat(22));
    // Another account signs in on the same browser: the row moves to it.
    const moved = await ctrl.subscribe(
      actor('u2'),
      { endpoint: EP, keys },
      req,
    );
    expect(moved.id).toBe(a.id);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].userId).toBe('u2');
  });

  it('POST refuses endpoints that are not push services, and 404s when off', async () => {
    const { ctrl } = setup();
    await expect(
      ctrl.subscribe(
        actor('u1'),
        { endpoint: 'https://internal.example/hook', keys },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup(false).ctrl.subscribe(actor('u1'), { endpoint: EP, keys }, req),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("DELETE removes only the caller's own subscription", async () => {
    const { db, ctrl } = setup();
    await ctrl.subscribe(actor('u1'), { endpoint: EP, keys }, req);
    expect(await ctrl.unsubscribe(actor('u2'), { endpoint: EP })).toEqual({
      removed: 0,
    });
    expect(db.rows).toHaveLength(1);
    expect(await ctrl.unsubscribe(actor('u1'), { endpoint: EP })).toEqual({
      removed: 1,
    });
    expect(db.rows).toHaveLength(0);
  });
});
