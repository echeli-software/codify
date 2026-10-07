import { Prisma } from '@prisma/client';

/**
 * True when `err` is Prisma's "unique constraint violated" error (P2002).
 * Centralised so catch blocks don't each have to narrow the `unknown`
 * error and read `.code` off it.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err as { code?: string }).code === 'P2002'
  );
}
