import type { Prisma } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors.js';

/** Thrown inside the processing transaction when the event was already applied. */
export class DuplicateWebhookEvent extends Error {
  constructor(readonly key: string) {
    super(`Webhook event ${key} already processed`);
  }
}

export interface WebhookResult {
  received: boolean;
  duplicate: boolean;
  handled: boolean;
}

export const DUPLICATE_RESULT: WebhookResult = {
  received: true,
  duplicate: true,
  handled: false,
};

/** Interactive-transaction budget for applying one webhook event. */
export const WEBHOOK_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 } as const;

/**
 * Claim an idempotency key INSIDE the transaction that applies the event.
 * The record commits only if processing commits, so a delivery that fails
 * half-way rolls the claim back and the provider's retry is processed
 * again — never mistaken for a duplicate. A concurrent duplicate blocks on
 * the primary key until the first transaction finishes, then collides.
 *
 * Only a collision on THIS insert means "duplicate"; unique violations
 * raised later by the processing itself propagate as real failures.
 */
export async function claimWebhookEvent(
  tx: Prisma.TransactionClient,
  key: string,
  scope: string,
): Promise<void> {
  try {
    await tx.idempotencyRecord.create({ data: { key, scope } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateWebhookEvent(key);
    throw err;
  }
}
