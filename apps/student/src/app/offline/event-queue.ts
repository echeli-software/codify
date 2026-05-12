import { idbStores, tx } from './db.js';

/**
 * Per /docs/16-offline §7: the queue is FIFO, ordered by clientTimestamp.
 * Phase 5b ships `lesson_complete` only — other event kinds land as
 * later phases add their features (scenario, avatar, prefs, etc.).
 *
 * Each event carries:
 *   - clientEventId: UUID v4, doubles as the API Idempotency-Key.
 *   - clientTimestamp: device ms-at-event so the server can attribute
 *     streaks / daily quests to the right day even if synced later.
 *   - userId: snapshotted so a different-user re-sign-in can discard
 *     the prior user's queue without crediting them.
 *   - attempts: how many flushes have tried this event; informs backoff.
 *   - lastError: last failure message, for the "Sync now" sheet.
 */
export type QueuedEvent = {
  kind: 'lesson_complete';
  clientEventId: string;
  clientTimestamp: number;
  userId: string;
  lessonId: string;
  attempts: number;
  lastError?: string | null;
};

export const EventQueue = {
  async enqueue(ev: QueuedEvent): Promise<void> {
    await tx<IDBValidKey>(idbStores.STORE_QUEUE, 'readwrite', (s) => s.put(ev));
  },

  /** Oldest-first by clientTimestamp. */
  list(): Promise<QueuedEvent[]> {
    return tx<QueuedEvent[]>(idbStores.STORE_QUEUE, 'readonly', (s) => {
      return new Promise<QueuedEvent[]>((resolve, reject) => {
        const out: QueuedEvent[] = [];
        const idx = s.index('byTimestamp');
        const req = idx.openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve(out);
          out.push(cur.value as QueuedEvent);
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  },

  async remove(clientEventId: string): Promise<void> {
    await tx<undefined>(idbStores.STORE_QUEUE, 'readwrite', (s) =>
      s.delete(clientEventId),
    );
  },

  async update(ev: QueuedEvent): Promise<void> {
    await tx<IDBValidKey>(idbStores.STORE_QUEUE, 'readwrite', (s) => s.put(ev));
  },

  /** Drop everything for a given user (different-user sign-in). */
  clearForUser(userId: string): Promise<number> {
    return tx<number>(idbStores.STORE_QUEUE, 'readwrite', (s) => {
      return new Promise<number>((resolve, reject) => {
        let removed = 0;
        const req = s.openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve(removed);
          const v = cur.value as QueuedEvent;
          if (v.userId === userId) {
            cur.delete();
            removed += 1;
          }
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  },

  size(): Promise<number> {
    return tx<number>(idbStores.STORE_QUEUE, 'readonly', (s) => {
      const req = s.count();
      return req as unknown as IDBRequest<number>;
    });
  },
};

/** UUID v4. Avoids importing from api-client to keep this lib browser-only. */
export function newClientEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback: math-random UUID — only used in environments without webcrypto.
  let n = '';
  for (let i = 0; i < 32; i += 1) n += Math.floor(Math.random() * 16).toString(16);
  return (
    n.slice(0, 8) +
    '-' +
    n.slice(8, 12) +
    '-4' +
    n.slice(13, 16) +
    '-a' +
    n.slice(17, 20) +
    '-' +
    n.slice(20)
  );
}
