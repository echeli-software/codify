import { TestBed } from '@angular/core/testing';
import { TelemetryService } from '../telemetry/telemetry.service';
import { NativePushService } from './native-push.service';
import {
  LOCAL_REMINDER_ID,
  NativeShellService,
  setNativeShellPlugins,
} from './native-shell.service';

const COPY = { title: 'Time to learn', body: 'Your pet is waiting' };

describe('NativeShellService', () => {
  let permission: jest.Mock;
  let ln: {
    cancel: jest.Mock;
    checkPermissions: jest.Mock;
    requestPermissions: jest.Mock;
    schedule: jest.Mock;
  };
  let browser: { open: jest.Mock };
  let statusBar: { setStyle: jest.Mock; setBackgroundColor: jest.Mock };
  let splash: { hide: jest.Mock };

  function native(platform: 'ios' | 'android' | null) {
    if (platform)
      (globalThis as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => platform,
      };
    else delete (globalThis as { Capacitor?: unknown }).Capacitor;
  }

  function setup() {
    permission = jest.fn(async () => 'denied');
    ln = {
      cancel: jest.fn(async () => undefined),
      checkPermissions: jest.fn(async () => ({ display: 'prompt' })),
      requestPermissions: jest.fn(async () => ({ display: 'granted' })),
      schedule: jest.fn(async () => ({ notifications: [] })),
    };
    browser = { open: jest.fn(async () => undefined) };
    statusBar = {
      setStyle: jest.fn(async () => undefined),
      setBackgroundColor: jest.fn(async () => undefined),
    };
    splash = { hide: jest.fn(async () => undefined) };
    setNativeShellPlugins({
      localNotifications: async () => ln as never,
      browser: async () => browser as never,
      statusBar: async () => ({
        StatusBar: statusBar as never,
        Style: { Dark: 'DARK', Light: 'LIGHT' },
      }),
      splashScreen: async () => splash as never,
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: NativePushService, useValue: { permission } },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
      ],
    });
    return TestBed.inject(NativeShellService);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    setNativeShellPlugins(null);
    native(null);
    jest.restoreAllMocks();
  });

  it('is a web no-op for reminders, theme and splash', async () => {
    const svc = setup();
    await expect(svc.syncDailyReminder(600, COPY)).resolves.toBe('skipped');
    await svc.applyTheme(true);
    await svc.hideSplash();
    await svc.cancelDailyReminder();
    expect(ln.schedule).not.toHaveBeenCalled();
    expect(statusBar.setStyle).not.toHaveBeenCalled();
    expect(splash.hide).not.toHaveBeenCalled();
  });

  it('schedules a daily local reminder when remote push is off', async () => {
    native('android');
    const svc = setup();
    await expect(svc.syncDailyReminder(19 * 60 + 30, COPY)).resolves.toBe(
      'scheduled',
    );
    expect(ln.cancel).toHaveBeenCalledWith({
      notifications: [{ id: LOCAL_REMINDER_ID }],
    });
    expect(ln.requestPermissions).toHaveBeenCalled();
    const arg = ln.schedule.mock.calls[0][0];
    expect(arg.notifications[0]).toEqual(
      expect.objectContaining({
        id: LOCAL_REMINDER_ID,
        title: COPY.title,
        schedule: expect.objectContaining({
          on: { hour: 19, minute: 30 },
          repeats: true,
        }),
      }),
    );
  });

  it('defaults to 20:00 and cancels when remote push is granted', async () => {
    native('ios');
    const svc = setup();
    await svc.syncDailyReminder(null, COPY);
    expect(ln.schedule.mock.calls[0][0].notifications[0].schedule.on).toEqual({
      hour: 20,
      minute: 0,
    });
    permission.mockResolvedValueOnce('granted');
    ln.schedule.mockClear();
    await expect(svc.syncDailyReminder(600, COPY)).resolves.toBe('cancelled');
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('skips when local notification permission is refused', async () => {
    native('ios');
    const svc = setup();
    ln.requestPermissions.mockResolvedValueOnce({ display: 'denied' });
    await expect(svc.syncDailyReminder(600, COPY)).resolves.toBe('skipped');
    expect(ln.schedule).not.toHaveBeenCalled();
  });

  it('opens the portal in the in-app browser on native', async () => {
    native('ios');
    const svc = setup();
    await svc.openExternal('https://billing.stripe.test/p/1');
    expect(browser.open).toHaveBeenCalledWith({
      url: 'https://billing.stripe.test/p/1',
      presentationStyle: 'popover',
    });
  });

  it('opens a new tab on the web', async () => {
    const svc = setup();
    const tab = { opener: {} } as unknown as Window;
    const open = jest.spyOn(window, 'open').mockReturnValue(tab);
    await svc.openExternal('https://billing.stripe.test/p/2');
    expect(open).toHaveBeenCalledWith(
      'https://billing.stripe.test/p/2',
      '_blank',
    );
    expect(tab.opener).toBeNull();
    expect(browser.open).not.toHaveBeenCalled();
  });

  it('themes the status bar (colour on Android) and hides the splash', async () => {
    native('android');
    const svc = setup();
    await svc.applyTheme(true);
    expect(statusBar.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    expect(statusBar.setBackgroundColor).toHaveBeenCalledWith({
      color: '#0f172a',
    });
    await svc.applyTheme(false);
    expect(statusBar.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    await svc.hideSplash();
    expect(splash.hide).toHaveBeenCalled();
  });
});

describe('NativePlatformService theme + reminder wiring', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
    document.documentElement.classList.remove('theme-dark', 'theme-light');
  });

  it('follows the <html> theme class on native', async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    const applyTheme = jest.fn(async () => undefined);
    const shell = {
      applyTheme,
      hideSplash: jest.fn(async () => undefined),
      syncDailyReminder: jest.fn(async () => 'scheduled'),
      cancelDailyReminder: jest.fn(async () => undefined),
    };
    const { NativePlatformService } = await import('./native-platform.service');
    const { NotificationsClient } = await import('@codify/api-client');
    const { provideRouter } = await import('@angular/router');
    const { I18nService } = await import('@codify/i18n');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: I18nService, useValue: { t: (k: string) => k } },
        { provide: NativeShellService, useValue: shell },
        {
          provide: NativePushService,
          useValue: {
            init: jest.fn(async () => undefined),
            register: jest.fn(async () => false),
            unregister: jest.fn(async () => undefined),
          },
        },
        {
          provide: TelemetryService,
          useValue: { track: jest.fn(), flush: jest.fn() },
        },
        {
          provide: NotificationsClient,
          useValue: {
            preferences: jest.fn(async () => ({ reminderMinute: 450 })),
          },
        },
      ],
    });
    const svc = TestBed.inject(NativePlatformService);
    await svc.init();
    expect(shell.hideSplash).toHaveBeenCalled();
    expect(applyTheme).toHaveBeenLastCalledWith(false);
    document.documentElement.classList.add('theme-dark');
    await new Promise((r) => setTimeout(r, 0));
    expect(applyTheme).toHaveBeenLastCalledWith(true);

    // Loading @capacitor/app during init installs the web Capacitor global.
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    await svc.syncLocalReminder();
    expect(shell.syncDailyReminder).toHaveBeenCalledWith(
      450,
      expect.objectContaining({ title: expect.any(String) }),
    );
    await svc.onSignedOut();
    expect(shell.cancelDailyReminder).toHaveBeenCalled();
  });
});
