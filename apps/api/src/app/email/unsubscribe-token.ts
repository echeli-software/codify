import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationKind } from '@prisma/client';
import { isNotificationKind } from '../notifications/notification-kinds.js';

export const UNSUBSCRIBE_TOKENS = Symbol('UNSUBSCRIBE_TOKENS');

/**
 * Signed one-click unsubscribe tokens: `base64url(userId:kind).hmac` with
 * a server secret (`EMAIL_UNSUBSCRIBE_SECRET`). They never expire — an old
 * email's unsubscribe link must keep working — and only ever turn one
 * kind's email off, so a leaked token can't do anything else.
 */
export class UnsubscribeTokens {
  constructor(private readonly secret: string) {
    if (!secret) throw new Error('UnsubscribeTokens needs a secret');
  }

  sign(userId: string, kind: NotificationKind): string {
    const payload = Buffer.from(`${userId}:${kind}`).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  verify(
    token: string | null | undefined,
  ): { userId: string; kind: NotificationKind } | null {
    if (typeof token !== 'string' || token.length > 512) return null;
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const idx = decoded.lastIndexOf(':');
    if (idx <= 0) return null;
    const userId = decoded.slice(0, idx);
    const kind = decoded.slice(idx + 1);
    if (!isNotificationKind(kind)) return null;
    return { userId, kind };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(`unsubscribe:${payload}`)
      .digest('base64url');
  }
}
