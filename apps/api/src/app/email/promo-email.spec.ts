import { promoEmailCopy } from './copy.js';
import { DevEmailProvider } from './email.provider.js';
import { EmailService } from './email.service.js';
import { UnsubscribeTokens } from './unsubscribe-token.js';

const ENDS = new Date('2026-11-09T02:59:00Z');

describe('campaign email (PROMO)', () => {
  it('pt-BR and en-US copy name the bonus and when it ends, in the user zone', () => {
    const pt = promoEmailCopy('pt-BR', {
      value: 2,
      target: 'XP',
      courseTitle: null,
      endsAt: ENDS,
      timezone: 'America/Sao_Paulo',
    });
    expect(pt.title).toBe('Evento bônus: 2x XP no Codify');
    expect(pt.body).toContain('suas lições rendem 2x XP');
    expect(pt.lines).toEqual([
      'Bônus: 2x XP',
      'Termina: domingo, 8 de novembro às 23:59',
    ]);
    const en = promoEmailCopy('en-US', {
      value: 1.5,
      target: 'BOTH',
      courseTitle: 'React',
      endsAt: null,
    });
    expect(en.title).toBe('Bonus event: 1.5x XP and coins on React');
    expect(en.lines).toEqual(['Bonus: 1.5x XP and coins']);
  });

  it('goes out with the one-click unsubscribe and the opt-in reason', async () => {
    const provider = new DevEmailProvider();
    const svc = new EmailService(provider, new UnsubscribeTokens('s'), {
      studentApp: 'https://codify.app',
      api: 'https://api.codify.app/api',
    });
    const c = promoEmailCopy('en-US', {
      value: 2,
      target: 'COINS',
      courseTitle: null,
      endsAt: null,
    });
    await svc.send({
      userId: 'u1',
      to: 'ana@example.com',
      locale: 'en-US',
      kind: 'PROMO',
      title: c.title,
      body: c.body,
      lines: c.lines,
      deepLink: '/today',
    });
    const [mail] = provider.recent();
    expect(mail.subject).toBe('Bonus event: 2x coins on Codify');
    expect(mail.headers).toMatchObject({
      'List-Unsubscribe': expect.stringMatching(
        /^<https:\/\/api\.codify\.app\/api\/email\/unsubscribe\?token=/,
      ),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(mail.text).toContain(
      'You get this email because you chose to get bonus-event alerts by email.',
    );
    expect(mail.text).toContain('See the offer: https://codify.app/today');
    expect(mail.html).toContain('<li>Bonus: 2x coins</li>');
  });
});
