/**
 * Last-write-wins for offline avatar edits (docs/16 §8). The write's time
 * is the device `clientTimestamp` (already validated / clamped by
 * `validateClientTimestamp`) or "now" for live edits; a write older than
 * what the server already holds is ignored.
 */
export function avatarWriteTime(
  clientTimestamp: string | null | undefined,
  now = new Date(),
): Date {
  if (!clientTimestamp) return now;
  const t = new Date(clientTimestamp);
  return Number.isFinite(t.getTime()) && t <= now ? t : now;
}

/** True when the server already holds a newer change than `at`. */
export function isStaleWrite(
  at: Date,
  serverUpdatedAt: Date | null | undefined,
): boolean {
  return !!serverUpdatedAt && serverUpdatedAt.getTime() > at.getTime();
}
