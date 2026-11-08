import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Hosts of the browser push services a subscription endpoint may point at.
 * The API POSTs to whatever endpoint it stores, so only real push services
 * are accepted (no requests to internal hosts on a client's say-so).
 * Exact hosts, or any subdomain of a `.`-prefixed entry.
 */
export const WEB_PUSH_HOSTS: readonly string[] = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Samsung Internet
  'android.googleapis.com',
  'updates.push.services.mozilla.com', // Firefox
  '.push.services.mozilla.com',
  'web.push.apple.com', // Safari (macOS 13+, iOS/iPadOS 16.4+ home-screen apps)
  '.push.apple.com',
  '.notify.windows.com', // legacy Edge (WNS)
];

/** True for an `https://` endpoint on a known push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return WEB_PUSH_HOSTS.some((h) =>
    h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h,
  );
}

export interface WebPushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/**
 * The browser web push subscriptions of a user (`WebPushSubscription`,
 * one per browser profile). A subscription endpoint belongs to one
 * browser, so registering it binds it to the signed-in user: an endpoint
 * last registered by another account (shared computer, account switch)
 * is re-owned, and that account stops getting pushes in this browser.
 */
@Injectable()
export class WebPushSubscriptionsService {
  private readonly logger = new Logger(WebPushSubscriptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async subscribe(
    userId: string,
    input: WebPushSubscriptionInput,
  ): Promise<{ id: string }> {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw new BadRequestException({
        code: 'WEB_PUSH_ENDPOINT_NOT_ALLOWED',
        message: 'The subscription endpoint is not a known push service',
      });
    }
    const userAgent = input.userAgent?.slice(0, 512) || null;
    const data = {
      userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
      lastSeenAt: new Date(),
    };
    const existing = await this.prisma.webPushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { id: true, userId: true },
    });
    if (existing) {
      if (existing.userId !== userId) {
        this.logger.log(
          `web push subscription ${existing.id} re-owned from user ${existing.userId} to ${userId}`,
        );
      }
      return this.prisma.webPushSubscription.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
    }
    try {
      return await this.prisma.webPushSubscription.create({
        data: { ...data, endpoint: input.endpoint },
        select: { id: true },
      });
    } catch (err) {
      // Concurrent registration of the same endpoint: update instead.
      if (isUniqueViolation(err)) return this.subscribe(userId, input);
      throw err;
    }
  }

  async unsubscribe(
    userId: string,
    endpoint: string,
  ): Promise<{ removed: number }> {
    const res = await this.prisma.webPushSubscription.deleteMany({
      where: { endpoint, userId },
    });
    return { removed: res.count };
  }
}
