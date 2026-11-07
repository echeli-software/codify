import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { LOCKED_KINDS } from '../notifications/notification-kinds.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { unsubscribePageCopy } from './copy.js';
import { renderUnsubscribePage } from './email-templates.js';
import { EmailService } from './email.service.js';
import { UNSUBSCRIBE_TOKENS, UnsubscribeTokens } from './unsubscribe-token.js';

/** The page has inline styles only: no scripts, no external loads. */
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * One-click email unsubscribe (docs/10 §3). Every email links here with a
 * signed token naming (user, kind); visiting it — or the RFC 8058
 * `List-Unsubscribe-Post` POST mail clients send — turns that kind's email
 * off and answers a small translated HTML page. SYSTEM / BILLING email
 * can't be turned off; the page says so.
 */
@Controller('email')
export class EmailUnsubscribeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(UNSUBSCRIBE_TOKENS) private readonly tokens: UnsubscribeTokens,
  ) {}

  @Public()
  @Get('unsubscribe')
  get(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.handle(token, req, res);
  }

  @Public()
  @Post('unsubscribe')
  post(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.handle(token, req, res);
  }

  private async handle(
    token: string | undefined,
    req: Request,
    res: Response,
  ): Promise<void> {
    const claim = this.tokens.verify(token);
    const user = claim
      ? await this.prisma.user.findUnique({
          where: { id: claim.userId },
          select: { id: true, locale: true, deletedAt: true },
        })
      : null;
    const fallbackLocale = req.acceptsLanguages('pt-BR', 'pt', 'en-US', 'en');
    const locale =
      user?.locale ??
      (typeof fallbackLocale === 'string' ? fallbackLocale : 'pt-BR');

    let status = 200;
    let copy: ReturnType<typeof unsubscribePageCopy>;
    if (!claim || !user || user.deletedAt) {
      status = 400;
      copy = unsubscribePageCopy(locale, 'invalid');
    } else if (LOCKED_KINDS.has(claim.kind)) {
      copy = unsubscribePageCopy(locale, 'locked', claim.kind);
    } else {
      await this.prisma.notificationPreference.upsert({
        where: { userId_kind: { userId: user.id, kind: claim.kind } },
        create: { userId: user.id, kind: claim.kind, emailEnabled: false },
        update: { emailEnabled: false },
      });
      copy = unsubscribePageCopy(locale, 'done', claim.kind);
    }
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(renderUnsubscribePage(locale, copy, this.email.settingsUrl));
  }
}
