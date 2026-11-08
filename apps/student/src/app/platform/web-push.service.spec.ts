import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { WebPushClient } from '@codify/api-client';
import { BehaviorSubject, Subject } from 'rxjs';
import { NotificationsStore } from '../pages/notifications/notifications.store';
import { TelemetryService } from '../telemetry/telemetry.service';
import {
  WEB_PUSH_DISMISSED_KEY,
  WebPushService,
  detectWebPushSupport,
  isIosDevice,
  isStandalone,
} from './web-push.service';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A PushSubscription as the browser hands it out. */
function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/x') {
  return {
    endpoint,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'BKey', auth: 'auth' },
    }),
    unsubscribe: jest.fn(async () => true),
  } as unknown as PushSubscription & { unsubscribe: jest.Mock };
}

class FakeSwPush {
  isEnabled = true;
  readonly subscription = new BehaviorSubject<PushSubscription | null>(null);
  readonly notificationClicks = new Subject<{
    action: string;
    notification: { data?: unknown };
  }>();
  requestSubscription = jest.fn(async () => {
    const sub = fakeSubscription();
    this.subscription.next(sub);
    return sub;
  });
  unsubscribe = jest.fn(async () => {
    if (!this.subscription.value) throw new Error('Not subscribed');
    this.subscription.next(null);
  });
}

describe('web push support detection', () => {
  const base = {
    native: false,
    swEnabled: true,
    hasPushManager: true,
    hasNotification: true,
    ios: false,
    standalone: false,
  };

  it('supports desktop / Android browsers with a service worker', () => {
    expect(detectWebPushSupport(base)).toBe('supported');
  });

  it('native shell → native push, never web push', () => {
    expect(detectWebPushSupport({ ...base, native: true })).toBe('native');
  });

  it('iOS Safari needs the home-screen app; installed it works', () => {
    expect(detectWebPushSupport({ ...base, ios: true })).toBe('ios-install');
    expect(detectWebPushSupport({ ...base, ios: true, standalone: true })).toBe(
      'supported',
    );
  });

  it('no service worker / Push API → unsupported', () => {
    expect(detectWebPushSupport({ ...base, swEnabled: false })).toBe(
      'unsupported',
    );
    expect(detectWebPushSupport({ ...base, hasPushManager: false })).toBe(
      'unsupported',
    );
  });

  it('recognises iPhone, iPad (also as "Macintosh" with touch) and standalone', () => {
    expect(
      isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)' }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(isStandalone(undefined, { standalone: true })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: true }) }, {})).toBe(
      true,
    );
  });
});

describe('WebPushService', () => {
  let sw: FakeSwPush;
  let client: {
    config: jest.Mock;
    subscribe: jest.Mock;
    unsubscribe: jest.Mock;
  };
  let track: jest.Mock;
  let markReadFromPush: jest.Mock;
  let permission: NotificationPermission;

  function setup(opts: { swPush?: boolean } = {}) {
    sw = new FakeSwPush();
    client = {
      config: jest.fn(async () => ({ publicKey: 'BPublicKey' })),
      subscribe: jest.fn(async () => ({ id: 'w1' })),
      unsubscribe: jest.fn(async () => ({ removed: 1 })),
    };
    track = jest.fn();
    markReadFromPush = jest.fn(async () => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ...(opts.swPush === false ? [] : [{ provide: SwPush, useValue: sw }]),
        { provide: WebPushClient, useValue: client },
        { provide: TelemetryService, useValue: { track } },
        { provide: NotificationsStore, useValue: { markReadFromPush } },
      ],
    });
    return TestBed.inject(WebPushService);
  }

  beforeEach(() => {
    permission = 'default';
    (globalThis as { PushManager?: unknown }).PushManager = function () {
      /* present */
    };
    (globalThis as { Notification?: unknown }).Notification = {
      get permission() {
        return permission;
      },
    };
    localStorage.clear();
  });

  afterEach(() => {
    delete (globalThis as { PushManager?: unknown }).PushManager;
    delete (globalThis as { Notification?: unknown }).Notification;
    TestBed.resetTestingModule();
  });

  it('enable(): server key → browser prompt → registers the subscription', async () => {
    const svc = setup();
    sw.requestSubscription.mockImplementation(async () => {
      permission = 'granted';
      const sub = fakeSubscription();
      sw.subscription.next(sub);
      return sub;
    });
    expect(await svc.enable('prompt')).toBe('enabled');
    expect(sw.requestSubscription).toHaveBeenCalledWith({
      serverPublicKey: 'BPublicKey',
    });
    expect(client.subscribe).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: 'BKey', auth: 'auth' },
    });
    expect(svc.subscribed()).toBe(true);
    expect(svc.permission()).toBe('granted');
    expect(track).toHaveBeenCalledWith('push_registered', {
      platform: 'WEB',
      source: 'prompt',
    });
  });

  it('enable(): "Block" in the browser prompt → denied, nothing registered', async () => {
    const svc = setup();
    sw.requestSubscription.mockImplementation(async () => {
      permission = 'denied';
      throw new Error('Permission denied');
    });
    expect(await svc.enable('settings')).toBe('denied');
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(svc.permission()).toBe('denied');
  });

  it('enable(): the server refusing undoes the browser subscription', async () => {
    const svc = setup();
    const sub = fakeSubscription();
    sw.requestSubscription.mockResolvedValue(sub);
    client.subscribe.mockRejectedValue(new Error('500'));
    expect(await svc.enable('prompt')).toBe('error');
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(svc.subscribed()).toBe(false);
  });

  it('enable(): web push off on the server (404) → unavailable, no prompt', async () => {
    const svc = setup();
    client.config.mockRejectedValue(
      Object.assign(new Error('off'), { status: 404 }),
    );
    expect(await svc.enable('prompt')).toBe('unavailable');
    expect(sw.requestSubscription).not.toHaveBeenCalled();
  });

  it('enable() without a service worker (dev / native) is unavailable', async () => {
    const svc = setup({ swPush: false });
    expect(svc.support()).toBe('unsupported');
    expect(await svc.enable('prompt')).toBe('unavailable');
  });

  it('disable(): DELETEs on the server, then unsubscribes the browser', async () => {
    const svc = setup();
    svc.init();
    sw.subscription.next(
      fakeSubscription('https://fcm.googleapis.com/fcm/send/y'),
    );
    await svc.disable();
    expect(client.unsubscribe).toHaveBeenCalledWith(
      'https://fcm.googleapis.com/fcm/send/y',
    );
    expect(sw.unsubscribe).toHaveBeenCalled();
    expect(svc.subscribed()).toBe(false);
  });

  it('canOffer(): only while undecided, unsubscribed and not dismissed', async () => {
    const svc = setup();
    expect(await svc.canOffer()).toBe(true);
    permission = 'denied';
    expect(await svc.canOffer()).toBe(false);
    permission = 'default';
    sw.subscription.next(fakeSubscription());
    expect(await svc.canOffer()).toBe(false);
    sw.subscription.next(null);
    svc.dismissOffer();
    expect(localStorage.getItem(WEB_PUSH_DISMISSED_KEY)).toBeTruthy();
    expect(await svc.canOffer()).toBe(false);
  });

  it('sign-in re-binds an existing subscription; sign-out removes it', async () => {
    const svc = setup();
    sw.subscription.next(fakeSubscription());
    await svc.onSignedIn();
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    await svc.onSignedOut();
    expect(client.unsubscribe).toHaveBeenCalledTimes(1);
    expect(sw.subscription.value).toBeNull();
  });

  it('a notification tap with the app open routes in place and marks it read', async () => {
    const svc = setup();
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    svc.init();
    sw.notificationClicks.next({
      action: '',
      notification: {
        data: { url: '/league', notificationId: 'n1', kind: 'LEAGUE_RESULT' },
      },
    });
    await flush();
    expect(nav).toHaveBeenCalledWith('/league');
    expect(markReadFromPush).toHaveBeenCalledWith('n1');
    // Off-origin links are never followed.
    nav.mockClear();
    sw.notificationClicks.next({
      action: '',
      notification: { data: { url: 'https://evil.example/x' } },
    });
    await flush();
    expect(nav).not.toHaveBeenCalled();
  });
});
