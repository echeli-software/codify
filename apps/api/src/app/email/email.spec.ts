import {
  DEV_UNSUBSCRIBE_SECRET,
  createEmailLinks,
  createEmailProvider,
  createUnsubscribeTokens,
} from './email-config.js';
import { DevEmailProvider } from './email.provider.js';
import { EmailService, isDeliverableAddress } from './email.service.js';
import { EmailUnsubscribeController } from './email-unsubscribe.controller.js';
import { escapeHtml, renderEmail } from './email-templates.js';
import { ResendEmailProvider } from './resend-email.provider.js';
import { UnsubscribeTokens } from './unsubscribe-token.js';

describe('UnsubscribeTokens', () => {
  const tokens = new UnsubscribeTokens('secret');

  it('round-trips (user, kind)', () => {
    const t = tokens.sign(
      '01a1b75a-9e3a-794f-9246-97e5985c4f53',
      'WEEKLY_RECAP',
    );
    expect(tokens.verify(t)).toEqual({
      userId: '01a1b75a-9e3a-794f-9246-97e5985c4f53',
      kind: 'WEEKLY_RECAP',
    });
  });

  it('rejects tampered, foreign-secret and malformed tokens', () => {
    const t = tokens.sign('u1', 'WEEKLY_RECAP');
    const [, sig] = t.split('.');
    const forged = `${Buffer.from('u2:WEEKLY_RECAP').toString('base64url')}.${sig}`;
    expect(tokens.verify(forged)).toBeNull();
    expect(new UnsubscribeTokens('other').verify(t)).toBeNull();
    for (const bad of [undefined, '', 'x', 'a.b.c', `${t}x`]) {
      expect(tokens.verify(bad)).toBeNull();
    }
    const unknownKind = new UnsubscribeTokens('secret');
    const payload = Buffer.from('u1:NOPE').toString('base64url');
    const sigFor = unknownKind.sign('u1', 'PROMO').split('.')[1];
    expect(unknownKind.verify(`${payload}.${sigFor}`)).toBeNull();
  });
});

describe('email config', () => {
  it('uses Resend with both vars, the dev provider otherwise (outside production)', () => {
    expect(
      createEmailProvider({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' }),
    ).toBeInstanceOf(ResendEmailProvider);
    expect(createEmailProvider({})).toBeInstanceOf(DevEmailProvider);
    expect(createEmailProvider({ RESEND_API_KEY: 're_x' })).toBeInstanceOf(
      DevEmailProvider,
    );
  });

  it('refuses to boot in production without the provider or the unsubscribe secret', () => {
    expect(() => createEmailProvider({ NODE_ENV: 'production' })).toThrow(
      'RESEND_API_KEY and EMAIL_FROM are required in production',
    );
    expect(() =>
      createEmailProvider({ NODE_ENV: 'production', RESEND_API_KEY: 'k' }),
    ).toThrow('EMAIL_FROM is required in production');
    expect(() => createUnsubscribeTokens({ NODE_ENV: 'production' })).toThrow(
      'EMAIL_UNSUBSCRIBE_SECRET',
    );
  });

  it('has a dev unsubscribe secret and sensible links', () => {
    const dev = createUnsubscribeTokens({});
    expect(
      new UnsubscribeTokens(DEV_UNSUBSCRIBE_SECRET).verify(
        dev.sign('u', 'PROMO'),
      ),
    ).not.toBeNull();
    expect(createEmailLinks({ API_PORT: '3301' })).toEqual({
      studentApp: 'http://localhost:4202',
      api: 'http://localhost:3301/api',
    });
    expect(
      createEmailLinks({
        STUDENT_APP_URL: 'https://app.codify.app/',
        API_PUBLIC_URL: 'https://api.codify.app/api/',
      }),
    ).toEqual({
      studentApp: 'https://app.codify.app',
      api: 'https://api.codify.app/api',
    });
  });
});

describe('renderEmail', () => {
  const base = {
    title: 'Olá <Ana>',
    body: 'Corpo & mais',
    ctaUrl: 'https://app/today',
    unsubscribeUrl: 'https://api/email/unsubscribe?token=a.b',
    settingsUrl: 'https://app/settings/notifications',
  };

  it('renders an accessible, escaped pt-BR email with the unsubscribe link', () => {
    const r = renderEmail({
      ...base,
      kind: 'WEEKLY_RECAP',
      locale: 'pt-BR',
      lines: ['XP ganho: 120'],
      locked: false,
    });
    expect(r.subject).toBe('Olá <Ana>');
    expect(r.html).toContain('<html lang="pt-BR">');
    expect(r.html).toContain('Olá &lt;Ana&gt;');
    expect(r.html).toContain('Corpo &amp; mais');
    expect(r.html).toContain('<li>XP ganho: 120</li>');
    expect(r.html).toContain('href="https://api/email/unsubscribe?token=a.b"');
    expect(r.html).toContain('Cancelar emails de resumo semanal');
    expect(r.html).not.toContain('<script');
    expect(r.text).toContain('• XP ganho: 120');
    expect(r.text).toContain('Continuar aprendendo: https://app/today');
  });

  it('renders en-US and explains locked (billing) emails', () => {
    const r = renderEmail({
      ...base,
      kind: 'BILLING',
      locale: 'en',
      locked: true,
    });
    expect(r.html).toContain('<html lang="en-US">');
    expect(r.text).toContain('View subscription: https://app/today');
    expect(r.text).toContain('required for your account (billing)');
    expect(r.text).toContain('Manage emails:');
  });

  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('EmailService', () => {
  it('sends with List-Unsubscribe headers (one-click except for locked kinds)', async () => {
    const provider = new DevEmailProvider();
    const tokens = new UnsubscribeTokens('s');
    const svc = new EmailService(provider, tokens, {
      studentApp: 'https://app',
      api: 'https://api/api',
    });
    await svc.send({
      userId: 'u1',
      to: 'a@b.c',
      locale: 'pt-BR',
      kind: 'REACTIVATION',
      title: 't',
      body: 'b',
      deepLink: '/subscription?offer=winback',
    });
    await svc.send({
      userId: 'u1',
      to: 'a@b.c',
      locale: 'pt-BR',
      kind: 'BILLING',
      title: 't',
      body: 'b',
    });
    const [winback, billing] = provider.recent('a@b.c');
    const url = /<(.+)>/.exec(winback.headers?.['List-Unsubscribe'] ?? '')?.[1];
    expect(url).toMatch(/^https:\/\/api\/api\/email\/unsubscribe\?token=/);
    expect(
      tokens.verify(decodeURIComponent(url?.split('token=')[1] ?? '')),
    ).toEqual({ userId: 'u1', kind: 'REACTIVATION' });
    expect(winback.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
    expect(winback.text).toContain('https://app/subscription?offer=winback');
    expect(billing.headers?.['List-Unsubscribe-Post']).toBeUndefined();
  });

  it('never mails placeholder addresses', () => {
    expect(isDeliverableAddress('a@b.c')).toBe(true);
    expect(isDeliverableAddress('x@users.clerk.invalid')).toBe(false);
    expect(isDeliverableAddress('')).toBe(false);
  });
});

describe('EmailUnsubscribeController', () => {
  function setup(user: Record<string, unknown> | null) {
    const tokens = new UnsubscribeTokens('s');
    const prisma = {
      user: { findUnique: jest.fn(async () => user) },
      notificationPreference: { upsert: jest.fn(async () => ({})) },
    };
    const email = { settingsUrl: 'https://app/settings/notifications' };
    const ctrl = new EmailUnsubscribeController(
      prisma as never,
      email as never,
      tokens,
    );
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: '',
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      send(b: string) {
        this.body = b;
      },
    };
    const req = { acceptsLanguages: () => 'en-US' };
    return { ctrl, tokens, prisma, res, req };
  }

  it('GET only asks to confirm — a link prefetch changes nothing', async () => {
    const { ctrl, tokens, prisma, res, req } = setup({
      id: 'u1',
      locale: 'en-US',
      deletedAt: null,
    });
    await ctrl.get(
      tokens.sign('u1', 'WEEKLY_RECAP'),
      req as never,
      res as never,
    );
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<form method="post">');
    expect(res.body).toContain('Unsubscribe from these emails?');
    expect(res.headers['Content-Security-Policy']).toContain(
      "form-action 'self'",
    );
  });

  it("POST turns the kind's email off and answers a translated page", async () => {
    const { ctrl, tokens, prisma, res, req } = setup({
      id: 'u1',
      locale: 'pt-BR',
      deletedAt: null,
    });
    await ctrl.post(
      tokens.sign('u1', 'WEEKLY_RECAP'),
      req as never,
      res as never,
    );
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId_kind: { userId: 'u1', kind: 'WEEKLY_RECAP' } },
      create: { userId: 'u1', kind: 'WEEKLY_RECAP', emailEnabled: false },
      update: { emailEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Inscrição cancelada');
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.headers['Content-Security-Policy']).toContain(
      "default-src 'none'",
    );
  });

  it('never turns off locked kinds; rejects bad tokens with 400', async () => {
    const ok = setup({ id: 'u1', locale: 'en-US', deletedAt: null });
    await ok.ctrl.post(
      ok.tokens.sign('u1', 'BILLING'),
      ok.req as never,
      ok.res as never,
    );
    expect(ok.prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(ok.res.body).toContain('This email is required');

    const bad = setup(null);
    await bad.ctrl.get('nope', bad.req as never, bad.res as never);
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.body).toContain('Invalid link');
  });
});
