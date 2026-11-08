import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import { provideI18n } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import { ConfirmDialogService, ToastService } from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  BillingClient,
  CoursesClient,
  EnrollmentsClient,
  ItemsClient,
  PlansClient,
  StaffToolsClient,
  UsersClient,
  type AuditEntry,
} from '@codify/api-client';
import { UserDetailPage } from './user-detail.page';
import { userAuditQuery } from './user-audit-tab.component';

const settle = () => new Promise((r) => setTimeout(r, 0));

const user = (role = 'STUDENT') => ({
  id: 'u1',
  email: 'ana@x.y',
  displayName: 'Ana',
  role,
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  totalXp: 10,
  coins: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: null,
  onboardedAt: null,
  marketingEmailOptIn: false,
});

const subscription = {
  id: 's1',
  planId: 'p1',
  planName: 'Pro',
  status: 'ACTIVE',
  source: 'ADMIN_GRANT',
  renews: false,
  cancelAtPeriodEnd: false,
  currentPeriodStart: '2026-11-01T00:00:00.000Z',
  currentPeriodEnd: '2026-12-01T00:00:00.000Z',
};

const enrollment = {
  id: 'e1',
  userId: 'u1',
  courseId: 'c1',
  source: 'PROMO',
  accessUntil: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1',
  createdAt: '2026-11-08T10:00:00.000Z',
  actorId: 'admin1',
  actorName: 'Boss',
  actorEmail: 'boss@x.y',
  actorRole: 'ADMIN',
  action: 'user.role_changed',
  entity: 'User',
  entityId: 'u1',
  diff: { before: { role: 'STUDENT' }, after: { role: 'TEACHER' } },
  ip: '1.2.3.4',
  userAgent: 'jest',
  ...over,
});

async function mount(
  opts: { role?: string; confirm?: boolean; viewer?: string } = {},
) {
  const billing = {
    adminUserSubscriptions: jest
      .fn()
      .mockResolvedValue({ subscriptions: [subscription] }),
    adminCancel: jest
      .fn()
      .mockResolvedValue({ ...subscription, status: 'CANCELED' }),
  };
  const enrollments = {
    forUser: jest.fn().mockResolvedValue([enrollment]),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const ops = {
    audit: jest
      .fn()
      .mockResolvedValue({ items: [entry()], nextCursor: 'next-1' }),
  };
  const confirm = { open: jest.fn().mockResolvedValue(opts.confirm ?? true) };
  const toast = {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  await TestBed.configureTestingModule({
    imports: [UserDetailPage],
    providers: [
      provideRouter([]),
      provideI18n(),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ id: 'u1' })) },
      },
      {
        provide: UsersClient,
        useValue: {
          detail: jest.fn().mockResolvedValue(user(opts.role)),
        },
      },
      { provide: BillingClient, useValue: billing },
      { provide: EnrollmentsClient, useValue: enrollments },
      {
        provide: PlansClient,
        useValue: { list: jest.fn().mockResolvedValue({ items: [] }) },
      },
      {
        provide: CoursesClient,
        useValue: {
          list: jest.fn().mockResolvedValue({
            items: [{ id: 'c1', title: 'JS', slug: 'js' }],
          }),
        },
      },
      { provide: AdminOpsClient, useValue: ops },
      { provide: ItemsClient, useValue: { listItems: jest.fn() } },
      { provide: StaffToolsClient, useValue: {} },
      {
        provide: AuthService,
        useValue: {
          role: () => opts.viewer ?? 'ADMIN',
          user: () => ({ id: 'admin1', email: 'boss@x.y' }),
          whenReady: () => Promise.resolve(),
        },
      },
      { provide: ConfirmDialogService, useValue: confirm },
      { provide: ToastService, useValue: toast },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(UserDetailPage);
  fixture.detectChanges();
  await settle();
  await settle();
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const openTab = async (t: string) => {
    (el.querySelector(`#utab-${t}`) as HTMLElement).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  };
  const click = async (sel: string) => {
    (el.querySelector(sel) as HTMLElement).click();
    fixture.detectChanges();
    await settle();
    await settle();
    fixture.detectChanges();
  };
  return { fixture, el, billing, enrollments, ops, confirm, openTab, click };
}

describe('UserDetailPage — typed confirmation (SEC-8)', () => {
  it('cancelling a subscription asks for the email typed back', async () => {
    const { openTab, click, confirm, billing } = await mount();
    await openTab('subscriptions');
    await click('[data-subscription="s1"] cdf-button button');
    await click('[data-subscription="s1"] .row-actions cdf-button button');
    expect(confirm.open).toHaveBeenCalledWith(
      expect.objectContaining({
        typeToConfirm: 'ana@x.y',
        confirmKind: 'danger',
      }),
    );
    expect(billing.adminCancel).toHaveBeenCalledWith('s1', {
      mode: 'immediate',
      reason: undefined,
    });
  });

  it('a dismissed confirmation cancels nothing', async () => {
    const { openTab, click, billing } = await mount({ confirm: false });
    await openTab('subscriptions');
    await click('[data-subscription="s1"] cdf-button button');
    await click('[data-subscription="s1"] .row-actions cdf-button button');
    expect(billing.adminCancel).not.toHaveBeenCalled();
  });

  it('revoking an enrollment asks for the email typed back', async () => {
    const { openTab, click, confirm, enrollments, el } = await mount();
    await openTab('enrollments');
    await click('[data-enrollment="e1"] cdf-button button');
    expect(confirm.open).toHaveBeenCalledWith(
      expect.objectContaining({ typeToConfirm: 'ana@x.y' }),
    );
    expect(enrollments.revoke).toHaveBeenCalledWith('e1');
    expect(el.querySelector('[data-enrollment="e1"]')).toBeNull();
  });
});

describe('UserDetailPage — Audit tab (STF-8)', () => {
  it('builds the query for each scope', () => {
    expect(userAuditQuery('u1', 'about')).toEqual({
      entityType: 'User',
      entityId: 'u1',
    });
    expect(userAuditQuery('u1', 'actions')).toEqual({ actorId: 'u1' });
  });

  it('lists entries about a student, with the diff viewer', async () => {
    const { openTab, click, ops, el } = await mount();
    await openTab('audit');
    expect(ops.audit).toHaveBeenCalledWith({
      entityType: 'User',
      entityId: 'u1',
      limit: 25,
    });
    // Students have no "actions by" scope.
    expect(el.querySelector('[data-audit-scope]')).toBeNull();
    expect(
      el.querySelector('[data-testid="user-audit-table"]')?.textContent,
    ).toContain('user.role_changed');
    await click('[data-audit="a1"] cdf-button button');
    const diff = el.querySelector('#udiff-a1')?.textContent ?? '';
    expect(diff).toContain('STUDENT');
    expect(diff).toContain('TEACHER');
  });

  it('staff users also list the actions they made, paged', async () => {
    const { openTab, click, ops, el } = await mount({ role: 'SUPPORT' });
    await openTab('audit');
    ops.audit.mockResolvedValueOnce({
      items: [entry({ id: 'a2', actorId: 'u1', action: 'user.suspended' })],
      nextCursor: null,
    });
    await click('[data-audit-scope="actions"]');
    expect(ops.audit).toHaveBeenLastCalledWith({ actorId: 'u1', limit: 25 });
    expect(
      el.querySelector('[data-testid="user-audit-table"]')?.textContent,
    ).toContain('user.suspended');
  });

  it('a failed load shows an inline error with retry', async () => {
    const { openTab, click, ops, el } = await mount();
    ops.audit.mockRejectedValueOnce(new Error('boom'));
    await openTab('audit');
    expect(el.querySelector('[data-testid="load-error"]')).not.toBeNull();
    await click('[data-testid="load-error"] cdf-button button');
    expect(ops.audit).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="user-audit-table"]')).not.toBeNull();
  });
});
