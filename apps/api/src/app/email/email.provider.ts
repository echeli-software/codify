import { Logger } from '@nestjs/common';

/**
 * Transactional email seam (docs/10 §3 "Email (transactional via
 * Postmark/Resend)"). Production uses Resend over its HTTP API; locally a
 * DevEmailProvider logs and keeps the last messages in memory so flows are
 * verifiable without a provider account. The EMAIL Notification row (the
 * delivery log) is written by NotificationService for every provider.
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers (List-Unsubscribe, …). */
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  /** Provider message id. */
  id: string;
}

export interface EmailProvider {
  readonly mode: 'dev' | 'resend';
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface CapturedEmail extends EmailMessage {
  id: string;
  at: string;
}

const RING_SIZE = 100;

export class DevEmailProvider implements EmailProvider {
  readonly mode = 'dev' as const;
  private readonly logger = new Logger(DevEmailProvider.name);
  private readonly ring: CapturedEmail[] = [];
  private seq = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const id = `dev-email-${Date.now().toString(36)}-${++this.seq}`;
    this.ring.push({ ...message, id, at: new Date().toISOString() });
    if (this.ring.length > RING_SIZE) this.ring.shift();
    this.logger.log(`[dev] email "${message.subject}" → ${message.to} (${id})`);
    return { id };
  }

  /** Recent captured emails (newest last), optionally for one address. */
  recent(to?: string): CapturedEmail[] {
    return to ? this.ring.filter((m) => m.to === to) : [...this.ring];
  }
}
