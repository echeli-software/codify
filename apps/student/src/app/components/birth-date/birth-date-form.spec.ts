import { TestBed } from '@angular/core/testing';
import { MeClient, ProblemDetailsError } from '@codify/api-client';
import { provideI18n } from '@codify/i18n';
import { AppSessionService } from '../../platform/app-session.service';
import {
  BirthDateFormComponent,
  TOO_YOUNG_ROUTE,
} from './birth-date-form.component';
import { AgeGateService } from './birth-date';

const problem = (status: number, code: string, extra = {}) =>
  new ProblemDetailsError({
    status,
    code,
    title: 'x',
    data: extra,
  } as never);

async function mount(setBirthDate: jest.Mock, me = jest.fn()) {
  const session = { endDeletedAccount: jest.fn(async () => undefined) };
  await TestBed.configureTestingModule({
    imports: [BirthDateFormComponent],
    providers: [
      provideI18n(),
      { provide: MeClient, useValue: { setBirthDate, me } },
      { provide: AppSessionService, useValue: session },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(BirthDateFormComponent);
  fixture.componentRef.setInput('idPrefix', 't');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends Element>(id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as T;
  const fill = (day: string, month: string, year: string) => {
    const d = q<HTMLInputElement>('dob-day');
    d.value = day;
    d.dispatchEvent(new Event('input'));
    const m = q<HTMLSelectElement>('dob-month');
    m.value = month;
    m.dispatchEvent(new Event('change'));
    const y = q<HTMLInputElement>('dob-year');
    y.value = year;
    y.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    q<HTMLFormElement>('birth-date-form').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
  };
  const saved = jest.fn();
  fixture.componentInstance.saved.subscribe(saved);
  return {
    fixture,
    el,
    q,
    fill,
    submit,
    saved,
    session,
    gate: TestBed.inject(AgeGateService),
  };
}

describe('BirthDateFormComponent', () => {
  it('is one labelled fieldset with day / month / year in the locale order', async () => {
    const { el } = await mount(jest.fn());
    const fieldset = el.querySelector('fieldset')!;
    expect(fieldset.querySelector('legend')).not.toBeNull();
    const ids = Array.from(fieldset.querySelectorAll('input, select')).map(
      (c) => c.id,
    );
    // Test locale en-US: month, day, year.
    expect(ids).toEqual(['t-month', 't-day', 't-year']);
    for (const id of ids)
      expect(el.querySelector(`label[for="${id}"]`)).not.toBeNull();
    expect(el.querySelectorAll('#t-month option')).toHaveLength(13);
  });

  it('saves the date and hands GET /me back', async () => {
    const me = {
      birthDate: '2011-06-15',
      ageGroup: 'minor',
      onboardedAt: null,
    };
    const setBirthDate = jest.fn(async () => me);
    const { fill, submit, saved, gate } = await mount(setBirthDate);
    fill('15', '6', '2011');
    await submit();
    expect(setBirthDate).toHaveBeenCalledWith('2011-06-15');
    expect(saved).toHaveBeenCalledWith(me);
    expect(gate.birthDate()).toBe('2011-06-15');
  });

  it('checks the date before sending it', async () => {
    const setBirthDate = jest.fn();
    const { fill, submit, q } = await mount(setBirthDate);
    await submit();
    expect(q('dob-error')).not.toBeNull();
    expect(q('dob-error').getAttribute('role')).toBe('alert');
    fill('31', '2', '2011');
    await submit();
    expect(q('dob-error').textContent).toContain("That date doesn't exist");
    expect(setBirthDate).not.toHaveBeenCalled();
    expect(
      q('birth-date-form')
        .querySelector('fieldset')!
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('under 12: signs out to the "ages 12 and up" page (account deleted)', async () => {
    const setBirthDate = jest.fn(async () => {
      throw problem(403, 'AGE_BELOW_MINIMUM', { accountDeleted: true });
    });
    const { fill, submit, session, saved } = await mount(setBirthDate);
    fill('1', '1', '2016');
    await submit();
    expect(session.endDeletedAccount).toHaveBeenCalledWith(TOO_YOUNG_ROUTE);
    expect(saved).not.toHaveBeenCalled();
  });

  it('shows the API reason, and takes the server state on 409', async () => {
    const setBirthDate = jest
      .fn()
      .mockRejectedValueOnce(
        problem(400, 'BIRTH_DATE_INVALID', { reason: 'future' }),
      )
      .mockRejectedValueOnce(problem(409, 'BIRTH_DATE_ALREADY_SET'));
    const me = jest.fn(async () => ({
      birthDate: '1990-01-01',
      ageGroup: 'adult',
      onboardedAt: null,
    }));
    const { fill, submit, q, saved } = await mount(setBirthDate, me);
    fill('1', '1', '1990');
    await submit();
    expect(q('dob-error').textContent).toContain("can't be in the future");
    await submit();
    expect(me).toHaveBeenCalled();
    expect(saved).toHaveBeenCalled();
  });

  it('reports other failures', async () => {
    const { fill, submit, q } = await mount(
      jest.fn(async () => {
        throw new Error('offline');
      }),
    );
    fill('1', '1', '1990');
    await submit();
    expect(q('dob-error').textContent).toContain("couldn't save");
  });
});
