import { TestBed } from '@angular/core/testing';
import { provideI18n } from '@codify/i18n';
import { ConfirmDialogService, ToastService } from '@codify/ui-bootstrap';
import { UsersClient } from '@codify/api-client';
import {
  UserAgePanelComponent,
  ageGroupVariant,
  deletesAccount,
} from './user-age-panel.component';

describe('age panel helpers', () => {
  it('flags dates that would delete the account (under 12)', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(deletesAccount('2015-01-01', now)).toBe(true);
    expect(deletesAccount('2014-11-08', now)).toBe(false); // 12 today
    expect(deletesAccount('1990-01-01', now)).toBe(false);
    expect(deletesAccount('2030-01-01', now)).toBe(false); // invalid: refused
  });

  it('colours the age group', () => {
    expect(ageGroupVariant('minor')).toBe('warning');
    expect(ageGroupVariant('adult')).toBe('neutral');
    expect(ageGroupVariant(null)).toBe('info');
  });
});

describe('UserAgePanelComponent (docs/14 "Minors")', () => {
  async function setup(result: unknown, ageGroup: 'minor' | 'adult' | null) {
    const users = { correctBirthDate: jest.fn().mockResolvedValue(result) };
    const confirm = { open: jest.fn().mockResolvedValue(true) };
    const toast = { success: jest.fn(), error: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [UserAgePanelComponent],
      providers: [
        provideI18n(),
        { provide: UsersClient, useValue: users },
        { provide: ConfirmDialogService, useValue: confirm },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UserAgePanelComponent);
    fixture.componentRef.setInput('userId', 'u1');
    fixture.componentRef.setInput('email', 'kid@x.y');
    fixture.componentRef.setInput('ageGroup', ageGroup);
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel = fixture.componentInstance as any;
    const corrected = jest.fn();
    fixture.componentInstance.corrected.subscribe(corrected);
    return { fixture, panel, users, confirm, toast, corrected };
  }

  it('shows the age group, never a date', async () => {
    const { fixture } = await setup(null, 'minor');
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="age-group-badge"]')!.textContent,
    ).toContain('Under 18');
    const none = await (async () => {
      fixture.componentRef.setInput('ageGroup', null);
      fixture.detectChanges();
      return el.querySelector('[data-testid="age-group-badge"]')!.textContent;
    })();
    expect(none).toContain('Not given');
  });

  it('corrects with a typed confirmation (the email) and "CORRECT"', async () => {
    const res = {
      userId: 'u1',
      before: { ageGroup: 'minor' },
      after: { ageGroup: 'adult' },
    };
    const { panel, users, confirm, corrected, toast } = await setup(
      res,
      'minor',
    );
    panel.birthDate = '1990-05-20';
    panel.reason = 'ticket 42';
    await panel.submit(new Event('submit'));
    expect(confirm.open).toHaveBeenCalledWith(
      expect.objectContaining({ typeToConfirm: 'kid@x.y' }),
    );
    expect(users.correctBirthDate).toHaveBeenCalledWith('u1', {
      birthDate: '1990-05-20',
      confirm: 'CORRECT',
      reason: 'ticket 42',
    });
    expect(corrected).toHaveBeenCalledWith(res);
    expect(toast.success).toHaveBeenCalled();
  });

  it('warns that an under-12 date deletes the account', async () => {
    const { panel, confirm, corrected } = await setup(
      { userId: 'u1', before: { ageGroup: 'minor' }, after: { deleted: true } },
      'minor',
    );
    panel.birthDate = '2016-01-01';
    await panel.submit(new Event('submit'));
    const opts = confirm.open.mock.calls[0][0];
    expect(opts.message).toContain('deleted at once');
    expect(opts.confirmLabel).toBe('Delete the account');
    expect(corrected).toHaveBeenCalledWith(
      expect.objectContaining({ after: { deleted: true } }),
    );
  });

  it('refuses an impossible date without asking, and stops on cancel', async () => {
    const { panel, confirm, users } = await setup(null, null);
    panel.birthDate = '2030-01-01';
    await panel.submit(new Event('submit'));
    expect(confirm.open).not.toHaveBeenCalled();
    expect(panel.dateError()).toBeTruthy();
    confirm.open.mockResolvedValueOnce(false);
    panel.birthDate = '1990-01-01';
    await panel.submit(new Event('submit'));
    expect(users.correctBirthDate).not.toHaveBeenCalled();
  });
});
