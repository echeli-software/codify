import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MeClient, NotificationsClient } from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { provideI18n } from '@codify/i18n';
import { NativePlatformService } from '../../native/native-platform.service';
import { AppSessionService } from '../../platform/app-session.service';
import { TelemetryService } from '../../telemetry/telemetry.service';
import { OnboardingFlowComponent } from '../onboarding-flow.component';
import { BirthDateGateComponent } from './birth-date-gate.component';
import { AgeGateService } from './birth-date';

const tick = () => new Promise((r) => setTimeout(r, 0));

function providers(me: jest.Mock, setBirthDate: jest.Mock) {
  return [
    provideI18n(),
    provideRouter([
      { path: 'today', children: [] },
      { path: 'catalog', children: [] },
    ]),
    { provide: MeClient, useValue: { me, setBirthDate } },
    {
      provide: AppSessionService,
      useValue: { endDeletedAccount: jest.fn() },
    },
    {
      provide: AuthService,
      useValue: { user: signal({ id: 'u1', displayName: 'Bia' }) },
    },
    {
      provide: NotificationsClient,
      useValue: { updatePreferences: jest.fn() },
    },
    {
      provide: NativePlatformService,
      useValue: { syncLocalReminder: jest.fn(), isNative: false },
    },
    {
      provide: TelemetryService,
      useValue: { track: jest.fn(), onboardingStep: jest.fn() },
    },
  ];
}

function fillAndSubmit(el: HTMLElement, d: string, m: string, y: string) {
  const set = (id: string, v: string, ev: string) => {
    const c = el.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
    c.value = v;
    c.dispatchEvent(new Event(ev));
  };
  set('dob-day', d, 'input');
  set('dob-month', m, 'change');
  set('dob-year', y, 'input');
  el.querySelector('[data-testid="birth-date-form"]')!.dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

describe('Onboarding: date of birth first (docs/05 Onboarding)', () => {
  async function mount(askBirthDate: boolean) {
    const setBirthDate = jest.fn(async () => ({
      birthDate: '2011-06-15',
      ageGroup: 'minor',
      onboardedAt: null,
    }));
    await TestBed.configureTestingModule({
      imports: [OnboardingFlowComponent],
      providers: providers(jest.fn(), setBirthDate),
    }).compileComponents();
    const fixture = TestBed.createComponent(OnboardingFlowComponent);
    fixture.componentRef.setInput('slides', [
      { id: 'learn', icon: 'school', title: 'Learn', body: 'by doing' },
    ]);
    fixture.componentRef.setInput('askBirthDate', askBirthDate);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, setBirthDate };
  }

  it('starts with the date step and moves on once it is saved', async () => {
    const { fixture, el, setBirthDate } = await mount(true);
    expect(
      el.querySelector('[data-testid="onboarding-birth-date"]'),
    ).not.toBeNull();
    // Not skippable: no skip button on this step.
    expect(el.textContent).not.toContain('Skip');
    fillAndSubmit(el, '15', '6', '2011');
    await tick();
    fixture.detectChanges();
    expect(setBirthDate).toHaveBeenCalledWith('2011-06-15');
    expect(
      el.querySelector('[data-testid="onboarding-birth-date"]'),
    ).toBeNull();
    expect(el.querySelector('cdf-onboarding-carousel')).not.toBeNull();
  });

  it('skips the step when the account already has a date', async () => {
    const { el } = await mount(false);
    expect(
      el.querySelector('[data-testid="onboarding-birth-date"]'),
    ).toBeNull();
    expect(el.querySelector('cdf-onboarding-carousel')).not.toBeNull();
  });
});

describe('BirthDateGateComponent (existing users, one-time prompt)', () => {
  async function mount(birthDate: string | null, onboardedAt: string | null) {
    const me = jest.fn(async () => ({
      birthDate,
      ageGroup: birthDate ? 'adult' : null,
      onboardedAt,
    }));
    const setBirthDate = jest.fn(async () => ({
      birthDate: '1990-01-01',
      ageGroup: 'adult',
      onboardedAt,
    }));
    await TestBed.configureTestingModule({
      imports: [BirthDateGateComponent],
      providers: providers(me, setBirthDate),
    }).compileComponents();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(BirthDateGateComponent);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const shown = () => !!el.querySelector('[data-testid="birth-date-form"]');
    return { fixture, el, router, shown, setBirthDate };
  }

  it('blocks an account without a date until it is saved', async () => {
    const { fixture, el, router, shown, setBirthDate } = await mount(
      null,
      '2026-01-01T00:00:00Z',
    );
    await router.navigateByUrl('/catalog');
    fixture.detectChanges();
    expect(shown()).toBe(true);
    fillAndSubmit(el, '1', '1', '1990');
    await tick();
    fixture.detectChanges();
    expect(setBirthDate).toHaveBeenCalledWith('1990-01-01');
    expect(shown()).toBe(false);
  });

  it('never shows once a date is set', async () => {
    const { fixture, router, shown } = await mount('1990-01-01', null);
    await router.navigateByUrl('/catalog');
    fixture.detectChanges();
    expect(shown()).toBe(false);
  });

  it('on Today, waits for first-run onboarding (which asks first)', async () => {
    const { fixture, router, shown } = await mount(null, null);
    await router.navigateByUrl('/today');
    fixture.detectChanges();
    expect(shown()).toBe(false);
    const gate = TestBed.inject(AgeGateService);
    gate.todayOnboarding.set('onboarding');
    fixture.detectChanges();
    expect(shown()).toBe(false);
    // Today decided: no onboarding for this account → the prompt shows.
    gate.todayOnboarding.set('none');
    fixture.detectChanges();
    expect(shown()).toBe(true);
  });
});
