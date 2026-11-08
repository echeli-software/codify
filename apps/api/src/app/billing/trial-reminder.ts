import type { Prisma } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors.js';

/** docs/09 §9: push (+ email) reminder 2 days before a trial ends. */
export const TRIAL_REMINDER_DAYS = 2;
export const TRIAL_REMINDER_SCOPE = 'billing_trial_reminder';

/** One reminder per subscription per trial end (a changed trial end re-arms it). */
export function trialReminderKey(subscriptionId: string, trialEndsAt: Date) {
  return `${TRIAL_REMINDER_SCOPE}:${subscriptionId}:${trialEndsAt.toISOString()}`;
}

/**
 * Claim the reminder (IdempotencyRecord). False when the webhook or the job
 * already sent it. Uses createMany + skipDuplicates so a duplicate never
 * aborts the surrounding (webhook) transaction.
 */
export async function claimTrialReminder(
  db: Pick<Prisma.TransactionClient, 'idempotencyRecord'>,
  key: string,
  userId: string,
): Promise<boolean> {
  try {
    const res = await db.idempotencyRecord.createMany({
      data: [{ key, scope: TRIAL_REMINDER_SCOPE, userId }],
      skipDuplicates: true,
    });
    return res.count === 1;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}
