import type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from './email.provider.js';

export const RESEND_API_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Minimal fetch surface (lets tests inject a fake). */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Real delivery through Resend's HTTP API (`POST /emails`), plain fetch —
 * no SDK. `RESEND_API_KEY` authenticates, `EMAIL_FROM` is the verified
 * sender ("Codify <hello@codify.app>").
 */
export class ResendEmailProvider implements EmailProvider {
  readonly mode = 'resend' as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.headers ? { headers: message.headers } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new EmailDeliveryError(
        `Resend request failed: ${(err as Error).message}`,
        null,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { message?: unknown };
        detail = typeof body.message === 'string' ? body.message : '';
      } catch {
        // non-JSON error body
      }
      throw new EmailDeliveryError(
        `Resend rejected the email (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
        res.status,
      );
    }
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== 'string') {
      throw new EmailDeliveryError('Resend response has no id', res.status);
    }
    return { id: body.id };
  }
}
