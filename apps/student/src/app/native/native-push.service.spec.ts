import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DevicesClient, ProblemDetailsError } from '@codify/api-client';
import { AppToastService } from '../platform/app-toast.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { NativePushService, pushDeepLink } from './native-push.service';

type Listener = (event: Record<string, unknown>) => void;

/** In-memory stand-in for the native FirebaseMessaging plugin. */
interface FakePlugin {
  listeners: Map<string, Listener>;
  permission: string;
  token: string;
  checkPermissions: jest.Mock;
  requestPermissions: jest.Mock;
  getToken: jest.Mock;
  deleteToken: jest.Mock;
  addListener: jest.Mock;
  emit(name: string, event: Record<string, unknown>): void;
}

const plugin: FakePlugin = {
  listeners: new Map<string, Listener>(),
  permission: 'prompt',
  token: 'fcm-token-1',
  checkPermissions: jest.fn(async () => ({ receive: plugin.permission })),
  requestPermissions: jest.fn(async () => ({ receive: 'granted' })),
  getToken: jest.fn(async () => ({ token: plugin.token })),
  deleteToken: jest.fn(async () => undefined),
  addListener: jest.fn(async (name: string, fn: Listener) => {
    plugin.listeners.set(name, fn);
    return { remove: jest.fn() };
  }),
  emit(name, event) {
    plugin.listeners.get(name)?.(event);
  },
};

jest.mock('@capacitor/core', () => ({
  registerPlugin: jest.fn((name: string) => {
    if (name !== 'FirebaseMessaging') throw new Error(`unexpected ${name}`);
    return plugin;
  }),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('NativePushService', () => {
  let register: jest.Mock;
  let unregister: jest.Mock;
  let track: jest.Mock;
  let show: jest.Mock;

  function setup(platform: 'ios' | 'android' | null = 'ios') {
    if (platform)
      (globalThis as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => platform,
      };
    register = jest.fn().mockResolvedValue({ id: 'd1' });
    unregister = jest.fn().mockResolvedValue(undefined);
    track = jest.fn();
    show = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DevicesClient, useValue: { register, unregister } },
        { provide: TelemetryService, useValue: { track, flush: jest.fn() } },
        { provide: AppToastService, useValue: { show } },
      ],
    });
    const router = TestBed.inject(Router);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    return { svc: TestBed.inject(NativePushService), router };
  }

  beforeEach(() => {
    plugin.listeners.clear();
    plugin.permission = 'prompt';
    plugin.token = 'fcm-token-1';
    jest.clearAllMocks();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it('is a no-op on the web', async () => {
    const { svc } = setup(null);
    await expect(svc.register()).resolves.toBe(false);
    await svc.init();
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('prompts once, then registers the FCM token with the platform tag', async () => {
    const { svc } = setup('ios');
    await expect(svc.register()).resolves.toBe(true);
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('fcm-token-1', 'IOS');
    expect(svc.token).toBe('fcm-token-1');
    expect(track).toHaveBeenCalledWith('push_registered', { platform: 'IOS' });

    // Already granted + same token: no prompt, no second POST.
    plugin.permission = 'granted';
    await svc.register();
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('does not prompt again or register when permission was denied', async () => {
    plugin.permission = 'denied';
    const { svc } = setup('android');
    await expect(svc.register()).resolves.toBe(false);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.getToken).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('push_permission_denied', {
      platform: 'ANDROID',
    });
  });

  it('re-registers once on 409 device.rebind_required, gives up on other errors', async () => {
    const { svc } = setup('android');
    register
      .mockRejectedValueOnce(
        new ProblemDetailsError({
          status: 409,
          code: 'device.rebind_required',
        }),
      )
      .mockResolvedValueOnce({ id: 'd1' });
    await expect(svc.bindToken('tok')).resolves.toBe(true);
    expect(register).toHaveBeenCalledTimes(2);
    register
      .mockReset()
      .mockRejectedValue(new ProblemDetailsError({ status: 500 }));
    await expect(svc.bindToken('tok2')).resolves.toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('binds a refreshed token and drops the old binding', async () => {
    const { svc } = setup('ios');
    await svc.register();
    plugin.emit('tokenReceived', { token: 'fcm-token-2' });
    await flush();
    await flush();
    expect(register).toHaveBeenLastCalledWith('fcm-token-2', 'IOS');
    expect(unregister).toHaveBeenCalledWith('fcm-token-1');
    expect(svc.token).toBe('fcm-token-2');
  });

  it('ignores token refreshes while signed out', async () => {
    const { svc } = setup('ios');
    await svc.init();
    plugin.emit('tokenReceived', { token: 'fcm-token-9' });
    await flush();
    expect(register).not.toHaveBeenCalled();
  });

  it('deep-links a tapped notification (listener attached at boot)', async () => {
    const { svc, router } = setup('android');
    await svc.init();
    plugin.emit('notificationActionPerformed', {
      actionId: 'tap',
      notification: { data: { url: '/league', kind: 'LEAGUE_RESULT' } },
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/league');
    expect(track).toHaveBeenCalledWith('push_opened', { hasUrl: true });
  });

  it('never navigates to an external or protocol-relative link', async () => {
    const { svc, router } = setup('android');
    await svc.init();
    plugin.emit('notificationActionPerformed', {
      notification: { data: { url: '//evil.example/x' } },
    });
    plugin.emit('notificationActionPerformed', {
      notification: { data: { deepLink: 'https://evil.example/today' } },
    });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows Android foreground messages as an in-app toast with an Open action', async () => {
    const { svc, router } = setup('android');
    await svc.init();
    plugin.emit('notificationReceived', {
      notification: {
        title: 'Streak',
        body: 'Keep it going',
        data: { deepLink: '/today' },
      },
    });
    expect(show).toHaveBeenCalledTimes(1);
    const opts = show.mock.calls[0][0];
    expect(opts.message).toBe('Streak — Keep it going');
    expect(opts.action.label).toBe('studentPlatform.push.open');
    opts.action.handler();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/today');
  });

  it('leaves iOS foreground presentation to the OS', async () => {
    const { svc } = setup('ios');
    await svc.init();
    plugin.emit('notificationReceived', {
      notification: { title: 'Hi', body: 'There' },
    });
    expect(show).not.toHaveBeenCalled();
  });

  it('unregister() unbinds the device and deletes the FCM token', async () => {
    const { svc } = setup('ios');
    await svc.register();
    await svc.unregister();
    expect(unregister).toHaveBeenCalledWith('fcm-token-1');
    expect(plugin.deleteToken).toHaveBeenCalled();
    expect(svc.token).toBeNull();
  });
});

describe('pushDeepLink', () => {
  it('prefers deepLink, then url / route, then the FCM link', () => {
    expect(pushDeepLink({ data: { deepLink: '/a', url: '/b' } })).toBe('/a');
    expect(pushDeepLink({ data: { route: '/friends' } })).toBe('/friends');
    expect(pushDeepLink({ data: {}, link: '/shop' })).toBe('/shop');
    expect(pushDeepLink({ data: { url: '' } })).toBeNull();
    expect(pushDeepLink(undefined)).toBeNull();
  });

  it('accepts absolute URLs on the app origin only', () => {
    expect(
      pushDeepLink(
        { data: { url: 'https://app.codify.test/lessons/1?x=1' } },
        'https://app.codify.test',
      ),
    ).toBe('/lessons/1?x=1');
    expect(
      pushDeepLink(
        { data: { url: 'https://evil.test/lessons/1' } },
        'https://app.codify.test',
      ),
    ).toBeNull();
    expect(pushDeepLink({ data: { url: 'javascript:alert(1)' } })).toBeNull();
  });
});
