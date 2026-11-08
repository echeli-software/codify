import { ProblemDetailsError, toProblemDetails } from '@codify/api-client';

/**
 * Last successful responses of the browse screens (Catalog, Today, My
 * courses) so they still render offline (docs/16 §3 "last-fetched cached
 * list"). Keys are scoped by user id — another account signing in on the
 * device never sees them — and kept in localStorage (small JSON).
 */
const PREFIX = 'codify.rc.';
/** Older entries are still shown offline, just marked by their date. */
const MAX_ENTRY_BYTES = 200_000;

export interface CachedResponse<T> {
  value: T;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function key(userId: string, name: string): string {
  return `${PREFIX}${userId}.${name}`;
}

export function saveResponse<T>(
  userId: string | null | undefined,
  name: string,
  value: T,
  now = Date.now(),
): void {
  const s = storage();
  if (!s || !userId) return;
  try {
    const json = JSON.stringify({ value, savedAt: now });
    if (json.length > MAX_ENTRY_BYTES) return;
    s.setItem(key(userId, name), json);
  } catch {
    // Quota / private mode — best-effort.
  }
}

export function loadResponse<T>(
  userId: string | null | undefined,
  name: string,
): CachedResponse<T> | null {
  const s = storage();
  if (!s || !userId) return null;
  try {
    const raw = s.getItem(key(userId, name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedResponse<T>;
    return parsed && typeof parsed.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/** Remove every cached response of `userId` (or of everyone). */
export function clearResponses(userId?: string): number {
  const s = storage();
  if (!s) return 0;
  const prefix = userId ? `${PREFIX}${userId}.` : PREFIX;
  const doomed: string[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i);
    if (k?.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) s.removeItem(k);
  return doomed.length;
}

/** True when a request failed because the device couldn't reach the API. */
export function isNetworkFailure(err: unknown): boolean {
  return toProblemDetails(err).status === 0;
}

/**
 * Fetch with a cache fallback: on success the value is saved; on a network
 * failure (or while offline) the last saved value is returned with its
 * `savedAt` (`fromCache`). Other errors are rethrown.
 */
export async function withResponseCache<T>(
  userId: string | null | undefined,
  name: string,
  online: boolean,
  fetch: () => Promise<T>,
): Promise<{ value: T; fromCache: number | null }> {
  if (online) {
    try {
      const value = await fetch();
      saveResponse(userId, name, value);
      return { value, fromCache: null };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }
  const cached = loadResponse<T>(userId, name);
  if (cached) return { value: cached.value, fromCache: cached.savedAt };
  if (!online) throw offlineError();
  return { value: await fetch(), fromCache: null };
}

function offlineError(): Error {
  return new ProblemDetailsError({ status: 0, code: 'OFFLINE' });
}
