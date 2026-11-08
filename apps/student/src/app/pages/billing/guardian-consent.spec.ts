import { TestBed } from '@angular/core/testing';
import { BillingClient, ProblemDetailsError } from '@codify/api-client';
import { provideI18n } from '@codify/i18n';
import {
  GuardianConsentComponent,
  guardianFormProblem,
} from './guardian-consent.component';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('guardianFormProblem', () => {
  it('needs a name, a valid email and the tick box', () => {
    const ok = {
      name: 'Maria Souza',
      email: 'maria@example.com',
      confirmed: true,
    };
    expect(guardianFormProblem(ok)).toBeNull();
    expect(guardianFormProblem({ ...ok, name: ' M ' })).toBe('required');
    expect(guardianFormProblem({ ...ok, email: 'maria' })).toBe('required');
    expect(guardianFormProblem({ ...ok, confirmed: false })).toBe('required');
  });
});

describe('GuardianConsentComponent (docs/09 "Guardian step")', () => {
  async function mount(record: jest.Mock) {
    await TestBed.configureTestingModule({
      imports: [GuardianConsentComponent],
      providers: [
        provideI18n(),
        { provide: BillingClient, useValue: { recordGuardianConsent: record } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GuardianConsentComponent);
    fixture.componentRef.setInput('planPriceId', 'price-1');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = <T extends Element>(id: string) =>
      el.querySelector(`[data-testid="${id}"]`) as T;
    const done = jest.fn();
    fixture.componentInstance.confirmedConsent.subscribe(done);
    const fill = (name: string, email: string, confirmed: boolean) => {
      const n = q<HTMLInputElement>('guardian-name');
      n.value = name;
      n.dispatchEvent(new Event('input'));
      const e = q<HTMLInputElement>('guardian-email');
      e.value = email;
      e.dispatchEvent(new Event('input'));
      const c = q<HTMLInputElement>('guardian-confirm');
      c.checked = confirmed;
      c.dispatchEvent(new Event('change'));
    };
    const submit = async () => {
      q('guardian-consent').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await tick();
      fixture.detectChanges();
    };
    return { el, q, fill, submit, done };
  }

  it('labels every field and the 18+ / guardian tick box', async () => {
    const { el } = await mount(jest.fn());
    for (const id of ['gc-name', 'gc-email', 'gc-confirm'])
      expect(el.querySelector(`label[for="${id}"]`)).not.toBeNull();
    expect(el.textContent).toContain(
      "I am 18 or older and this user's parent or guardian",
    );
  });

  it('records the confirmation and lets checkout continue', async () => {
    const view = { id: 'gc1', guardianName: 'Maria Souza', noticeSent: true };
    const record = jest.fn(async () => view);
    const { fill, submit, done } = await mount(record);
    fill(' Maria Souza ', 'maria@example.com ', true);
    await submit();
    expect(record).toHaveBeenCalledWith({
      planPriceId: 'price-1',
      guardianName: 'Maria Souza',
      guardianEmail: 'maria@example.com',
      confirmed: true,
    });
    expect(done).toHaveBeenCalledWith(view);
  });

  it('does not send without the tick box', async () => {
    const record = jest.fn();
    const { fill, submit, q } = await mount(record);
    fill('Maria Souza', 'maria@example.com', false);
    await submit();
    expect(record).not.toHaveBeenCalled();
    expect(q('guardian-error').getAttribute('role')).toBe('alert');
  });

  it('explains the student-email and daily-limit refusals', async () => {
    const record = jest
      .fn()
      .mockRejectedValueOnce(
        new ProblemDetailsError({
          status: 400,
          code: 'GUARDIAN_EMAIL_IS_STUDENT',
        } as never),
      )
      .mockRejectedValueOnce(
        new ProblemDetailsError({
          status: 429,
          code: 'GUARDIAN_CONSENT_RATE_LIMITED',
        } as never),
      );
    const { fill, submit, q, done } = await mount(record);
    fill('Maria Souza', 'me@example.com', true);
    await submit();
    expect(q('guardian-error').textContent).toContain('not your own');
    await submit();
    expect(q('guardian-error').textContent).toContain('Try again tomorrow');
    expect(done).not.toHaveBeenCalled();
  });
});
