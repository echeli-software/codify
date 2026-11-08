import { Logger } from '@nestjs/common';
import webpush from 'web-push';

/**
 * Standard Web Push (RFC 8030 + VAPID, RFC 8292) for the student PWA,
 * sent with the `web-push` library straight to the browser's push service
 * (FCM for Chrome, Mozilla autopush, Apple's web push for installed iOS
 * web apps) — no Firebase SDK in the browser. Subscriptions come from
 * Angular's `SwPush.requestSubscription` and are stored as
 * `WebPushSubscription` rows; `PushService` delivers to them alongside the
 * native FCM tokens with the same rules.
 *
 * Off (no VAPID keys) outside production: `GET /push/web/config` answers
 * 404 and no web subscription is delivered to. Production refuses to boot
 * without VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 */

export const WEB_PUSH_PROVIDER = Symbol('WEB_PUSH_PROVIDER');

/** A stored browser subscription (the PushSubscription JSON, flattened). */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What a web push says — the same title/body/data as the native push. */
export interface WebPushContent {
  title: string;
  body: string;
  /** String payload (`url`, `kind`, `notificationId`, …). */
  data?: Record<string, string>;
}

export interface WebPushSendResult {
  sent: number;
  failed: number;
  /** Endpoints the push service answered 404 / 410 for (delete them). */
  expiredEndpoints: string[];
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact the push services can reach us at. */
  subject: string;
}

/** The slice of `web-push` we call (tests inject a fake). */
export interface WebPushSender {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: webpush.RequestOptions,
  ): Promise<{ statusCode: number }>;
}

/** Push services keep an undelivered message this long (seconds). */
export const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;
/** Concurrent requests per batch (one HTTPS request per subscription). */
const CONCURRENCY = 20;
/** The PWA icon shown next to the notification. */
export const WEB_PUSH_ICON = '/icons/icon-192x192.png';
export const WEB_PUSH_BADGE = '/icons/icon-96x96.png';

/** Status codes meaning the subscription is gone for good (RFC 8030 §7.3). */
const EXPIRED_STATUS = new Set([404, 410]);

/**
 * The JSON Angular's service worker (`ngsw-worker.js`) turns into a
 * notification: it shows `notification` with `showNotification`, and on a
 * tap runs `data.onActionClick.default` — `navigateLastFocusedOrOpen`
 * focuses an open app tab and navigates it to `url`, or opens a new one.
 * `SwPush.notificationClicks` also sees `data`, so an open app routes in
 * place. The URL is app-relative (`/today`): deep links are allowlisted
 * upstream (`safeDeepLink`).
 */
export function toWebPushPayload(content: WebPushContent): string {
  const data = content.data ?? {};
  const url = appPath(data['url'] ?? data['deepLink'] ?? data['route']);
  return JSON.stringify({
    notification: {
      title: content.title,
      body: content.body,
      icon: WEB_PUSH_ICON,
      badge: WEB_PUSH_BADGE,
      ...(data['notificationId'] ? { tag: data['notificationId'] } : {}),
      data: {
        ...data,
        url,
        onActionClick: {
          default: { operation: 'navigateLastFocusedOrOpen', url },
        },
      },
    },
  });
}

function appPath(link: string | undefined): string {
  if (typeof link !== 'string') return '/';
  const t = link.trim();
  return t.startsWith('/') && !t.startsWith('//') && t.length <= 512 ? t : '/';
}

export class WebPushProvider {
  private readonly logger = new Logger(WebPushProvider.name);
  private lastErrorLog = 0;

  constructor(
    private readonly vapid: VapidConfig | null,
    private readonly sender: WebPushSender = webpush,
  ) {}

  /** True when VAPID keys are configured (web push on). */
  get enabled(): boolean {
    return this.vapid !== null;
  }

  /** The VAPID public key the browser subscribes with, or null when off. */
  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async send(
    targets: readonly WebPushTarget[],
    content: WebPushContent,
  ): Promise<WebPushSendResult> {
    const result: WebPushSendResult = {
      sent: 0,
      failed: 0,
      expiredEndpoints: [],
    };
    const vapid = this.vapid;
    if (!vapid || targets.length === 0) return result;
    const payload = toWebPushPayload(content);
    const options: webpush.RequestOptions = {
      vapidDetails: vapid,
      TTL: WEB_PUSH_TTL_SECONDS,
      urgency: 'normal',
      timeout: 10_000,
    };
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (t) => {
          try {
            await this.sender.sendNotification(
              {
                endpoint: t.endpoint,
                keys: { p256dh: t.p256dh, auth: t.auth },
              },
              payload,
              options,
            );
            result.sent += 1;
          } catch (err) {
            result.failed += 1;
            const status = (err as { statusCode?: unknown }).statusCode;
            if (typeof status === 'number' && EXPIRED_STATUS.has(status)) {
              result.expiredEndpoints.push(t.endpoint);
              return;
            }
            this.logError(status, err);
          }
        }),
      );
    }
    return result;
  }

  /** Network / push-service errors repeat per message — log once a minute. */
  private logError(status: unknown, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 60_000) return;
    this.lastErrorLog = now;
    // Never log the endpoint: it is a bearer capability for the browser.
    this.logger.warn(
      `web push delivery failed (${typeof status === 'number' ? status : 'network'}): ${(err as Error).message ?? 'unknown error'}`,
    );
  }
}

const val = (env: NodeJS.ProcessEnv, key: string) => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

/**
 * VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT → web push on.
 * None → off (dev). Some but not all, or none in production → boot fails
 * naming what is missing (env.schema.ts checks production too).
 */
export function createWebPushProvider(
  env: NodeJS.ProcessEnv = process.env,
  sender?: WebPushSender,
): WebPushProvider {
  const publicKey = val(env, 'VAPID_PUBLIC_KEY');
  const privateKey = val(env, 'VAPID_PRIVATE_KEY');
  const subject = val(env, 'VAPID_SUBJECT');
  const missing = [
    ...(publicKey ? [] : ['VAPID_PUBLIC_KEY']),
    ...(privateKey ? [] : ['VAPID_PRIVATE_KEY']),
    ...(subject ? [] : ['VAPID_SUBJECT']),
  ];
  const prod = env['NODE_ENV'] === 'production';
  if (missing.length === 3 && !prod) {
    new Logger('NotificationsModule').log('VAPID keys unset — web push is off');
    return new WebPushProvider(null, sender);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required${prod ? ' in production' : ' (set all three VAPID variables or none)'} (web push).`,
    );
  }
  if (!/^(mailto:|https:\/\/)/.test(subject as string)) {
    throw new Error('VAPID_SUBJECT must be a mailto: or https:// URL');
  }
  // Validates the key pair's encoding up front (throws on a bad key).
  webpush.getVapidHeaders(
    'https://fcm.googleapis.com',
    subject as string,
    publicKey as string,
    privateKey as string,
    'aes128gcm',
  );
  return new WebPushProvider(
    {
      publicKey: publicKey as string,
      privateKey: privateKey as string,
      subject: subject as string,
    },
    sender,
  );
}
