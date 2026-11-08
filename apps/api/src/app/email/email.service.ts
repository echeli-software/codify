import { Inject, Injectable } from '@nestjs/common';
import type { NotificationKind } from '@prisma/client';
import { LOCKED_KINDS } from '../notifications/notification-kinds.js';
import { EMAIL_LINKS, type EmailLinks } from './email-config.js';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type EmailSendResult,
} from './email.provider.js';
import { renderEmail, type RenderedEmail } from './email-templates.js';
import { UNSUBSCRIBE_TOKENS, UnsubscribeTokens } from './unsubscribe-token.js';

export interface SendEmailInput {
  userId: string;
  to: string;
  locale: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** App-relative deep link for the call to action. */
  deepLink?: string | null;
  lines?: string[];
}

/** Placeholder addresses (Clerk without email, released emails) never get mail. */
export function isDeliverableAddress(
  email: string | null | undefined,
): boolean {
  if (!email || !email.includes('@')) return false;
  return !email.toLowerCase().endsWith('.invalid');
}

/**
 * Renders a transactional email (pt-BR / en-US by the user's locale) with
 * its signed unsubscribe link + List-Unsubscribe headers and hands it to
 * the configured EmailProvider. Preference/dormancy checks and the EMAIL
 * delivery-log row are NotificationService's job.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    @Inject(UNSUBSCRIBE_TOKENS) private readonly tokens: UnsubscribeTokens,
    @Inject(EMAIL_LINKS) private readonly links: EmailLinks,
  ) {}

  get mode(): EmailProvider['mode'] {
    return this.provider.mode;
  }

  unsubscribeUrl(userId: string, kind: NotificationKind): string {
    const token = this.tokens.sign(userId, kind);
    return `${this.links.api}/email/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  get settingsUrl(): string {
    return `${this.links.studentApp}/settings/notifications`;
  }

  /**
   * A one-off notice to someone who is not a user (a parent / guardian,
   * docs/09 "Guardian step"): already rendered, no unsubscribe link or
   * preference check — there is no subscription to manage.
   */
  async sendNotice(
    to: string,
    message: RenderedEmail,
  ): Promise<EmailSendResult> {
    return this.provider.send({ to, ...message });
  }

  async send(input: SendEmailInput): Promise<EmailSendResult> {
    const locked = LOCKED_KINDS.has(input.kind);
    const unsubscribeUrl = this.unsubscribeUrl(input.userId, input.kind);
    const rendered = renderEmail({
      kind: input.kind,
      locale: input.locale,
      title: input.title,
      body: input.body,
      lines: input.lines,
      ctaUrl: `${this.links.studentApp}${input.deepLink ?? '/today'}`,
      unsubscribeUrl,
      settingsUrl: this.settingsUrl,
      locked,
    });
    return this.provider.send({
      to: input.to,
      ...rendered,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        ...(locked
          ? {}
          : { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
      },
    });
  }
}
