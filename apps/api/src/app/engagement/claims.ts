import { isUniqueViolation } from '../prisma/prisma-errors.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Claim a one-time job slot (IdempotencyRecord). False when someone —
 * an earlier run, a concurrent replica — already claimed it.
 */
export async function claimOnce(
  prisma: Pick<PrismaService, 'idempotencyRecord'>,
  scope: string,
  key: string,
  userId: string,
): Promise<boolean> {
  try {
    await prisma.idempotencyRecord.create({
      data: { key: `${scope}:${key}`, scope, userId },
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

/** Give a claim back (the work did not happen; let a later run retry). */
export async function releaseClaim(
  prisma: Pick<PrismaService, 'idempotencyRecord'>,
  scope: string,
  key: string,
): Promise<void> {
  await prisma.idempotencyRecord.deleteMany({
    where: { key: `${scope}:${key}` },
  });
}

/** UTC-midnight Date keyed to a user-local calendar date ('YYYY-MM-DD'). */
export function localDateKey(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
