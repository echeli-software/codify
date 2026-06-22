import { Logger } from '@nestjs/common';

/**
 * Push-delivery seam. Production wires FCM (Android + web) and APNs (iOS)
 * behind this interface; locally a DevPushProvider records what *would* have
 * been delivered into an in-memory ring buffer so the whole register →
 * trigger → deliver flow is verifiable without real device tokens or keys.
 * Mirrors the BillingProvider / CodeExecutionProvider dev-stub pattern.
 *
 * Real native delivery (signed FCM/APNs, physical devices) is store-side and
 * deferred — see /docs/17-mobile.md §Push.
 */

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Deep-link + analytics payload; values must be strings (FCM constraint). */
  data?: Record<string, string>;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  /** Tokens the provider reported as permanently invalid (caller should prune). */
  invalidTokens: string[];
}

export interface PushProvider {
  readonly mode: 'dev' | 'fcm';
  send(messages: PushMessage[]): Promise<PushSendResult>;
}

/** A captured delivery, exposed via the dev inspection endpoint. */
export interface CapturedPush extends PushMessage {
  at: string;
}

const RING_SIZE = 200;

export class DevPushProvider implements PushProvider {
  readonly mode = 'dev' as const;
  private readonly logger = new Logger(DevPushProvider.name);
  private readonly ring: CapturedPush[] = [];

  async send(messages: PushMessage[]): Promise<PushSendResult> {
    for (const m of messages) {
      // A token shaped like "invalid-*" simulates a stale registration so the
      // pruning path is exercisable.
      if (m.token.startsWith('invalid-')) continue;
      this.ring.push({ ...m, at: new Date().toISOString() });
      if (this.ring.length > RING_SIZE) this.ring.shift();
    }
    const invalidTokens = messages.filter((m) => m.token.startsWith('invalid-')).map((m) => m.token);
    this.logger.log(`[dev] captured ${messages.length - invalidTokens.length} push(es), ${invalidTokens.length} invalid`);
    return { sent: messages.length - invalidTokens.length, failed: invalidTokens.length, invalidTokens };
  }

  /** Recent captured deliveries (newest last), optionally filtered by token. */
  recent(token?: string): CapturedPush[] {
    return token ? this.ring.filter((m) => m.token === token) : [...this.ring];
  }
}
