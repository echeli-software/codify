import { Logger } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { type Message, getMessaging } from 'firebase-admin/messaging';
import type {
  PushMessage,
  PushProvider,
  PushSendResult,
} from './push.provider.js';

/** FCM accepts at most 500 messages per sendEach call. */
const BATCH_SIZE = 500;

/**
 * Error codes meaning the registration token will never work again
 * (uninstalled app, token rotated, garbage). Only these prune the token —
 * transient/server/auth errors must not delete valid registrations.
 */
export const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const APP_NAME = 'codify-push';

/** Minimal messaging surface we use (lets tests inject a fake). */
export interface FcmMessaging {
  sendEach(messages: Message[]): Promise<{
    successCount: number;
    failureCount: number;
    responses: {
      success: boolean;
      error?: { code: string; message: string };
    }[];
  }>;
}

/**
 * Decode `FIREBASE_SERVICE_ACCOUNT_JSON` — base64 of the service-account
 * JSON (raw JSON is tolerated for local convenience).
 */
export function decodeServiceAccount(value: string): Record<string, string> {
  const trimmed = value.trim();
  const json = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON',
    );
  }
  const sa = parsed as Record<string, string>;
  if (!sa['project_id'] || !sa['client_email'] || !sa['private_key']) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id / client_email / private_key',
    );
  }
  return sa;
}

/** Build the FCM message: Android + web natively, iOS via FCM's APNs bridge. */
export function toFcmMessage(m: PushMessage): Message {
  return {
    token: m.token,
    notification: { title: m.title, body: m.body },
    data: m.data,
    android: { priority: 'high', notification: { sound: 'default' } },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default' } },
    },
    webpush: { notification: { title: m.title, body: m.body } },
  };
}

/**
 * Real push delivery through Firebase Cloud Messaging (firebase-admin).
 * Tokens FCM reports as unregistered/invalid are returned in
 * `invalidTokens` so callers prune them from DeviceToken.
 */
export class FcmPushProvider implements PushProvider {
  readonly mode = 'fcm' as const;
  private readonly logger = new Logger(FcmPushProvider.name);

  constructor(private readonly messaging: FcmMessaging) {}

  static fromServiceAccount(encoded: string): FcmPushProvider {
    const sa = decodeServiceAccount(encoded);
    const app =
      getApps().find((a) => a.name === APP_NAME) ??
      initializeApp(
        {
          credential: cert({
            projectId: sa['project_id'],
            clientEmail: sa['client_email'],
            privateKey: sa['private_key'],
          }),
          projectId: sa['project_id'],
        },
        APP_NAME,
      );
    return new FcmPushProvider(getMessaging(app));
  }

  async send(messages: PushMessage[]): Promise<PushSendResult> {
    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      try {
        const res = await this.messaging.sendEach(batch.map(toFcmMessage));
        res.responses.forEach((r, idx) => {
          if (r.success) {
            sent += 1;
            return;
          }
          failed += 1;
          const code = r.error?.code ?? 'unknown';
          if (INVALID_TOKEN_CODES.has(code))
            invalidTokens.push(batch[idx].token);
          else
            this.logger.warn(
              `FCM delivery failed (${code}): ${r.error?.message ?? ''}`,
            );
        });
      } catch (err) {
        // Whole-batch failure (credentials, network): nothing is pruned.
        failed += batch.length;
        this.logger.error(
          `FCM sendEach failed for ${batch.length} message(s): ${(err as Error).message}`,
        );
      }
    }
    return { sent, failed, invalidTokens: [...new Set(invalidTokens)] };
  }
}
