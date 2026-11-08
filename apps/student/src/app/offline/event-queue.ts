import { InjectionToken } from '@angular/core';
import { idbStores, tx } from './db.js';

/**
 * Per /docs/16-offline §7: the queue is FIFO, ordered by clientTimestamp.
 *
 * Each event carries:
 *   - clientEventId: UUID v4, doubles as the API Idempotency-Key.
 *   - clientTimestamp: device ms-at-event so the server can attribute
 *     streaks / daily quests to the right day even if synced later.
 *   - userId: snapshotted so a different-user sign-in can discard the
 *     prior user's queue without crediting them, and so a flush only ever
 *     sends the signed-in user's events.
 *   - attempts / nextAttemptAt: exponential backoff bookkeeping.
 *   - stuck: max attempts reached — no more automatic retries; the user can
 *     retry or discard it from the Sync sheet (docs/16 §10).
 *   - lastError: last failure message, for the "Sync now" sheet.
 */
interface QueuedEventBase {
  clientEventId: string;
  clientTimestamp: number;
  userId: string;
  attempts: number;
  lastError?: string | null;
  /** Epoch ms before which automatic flushes skip this event. */
  nextAttemptAt?: number;
  stuck?: boolean;
  /** Server rejected the clientTimestamp (too old): replay without it. */
  dropTimestamp?: boolean;
  /** Display title for the Sync sheet ("Lesson 'Hooks' — waiting to sync"). */
  lessonTitle?: string;
  /**
   * Locally estimated reward of a queued completion (lesson base XP / coins)
   * for the offline "estimated balance" (docs/16 §8). Server is canonical.
   */
  estimate?: { xp: number; coins: number };
}

export interface QueuedLessonComplete extends QueuedEventBase {
  kind: 'lesson_complete';
  lessonId: string;
}

/**
 * An offline quiz attempt (docs/16 §8): graded locally against the
 * bundle's answer hashes for instant feedback, graded for real on sync.
 * One row per (user, lesson) — the best local attempt replaces older ones.
 */
export interface QueuedQuizAttempt extends QueuedEventBase {
  kind: 'quiz_attempt';
  lessonId: string;
  answers: Record<string, string[]>;
  localCheck?: { allCorrect: boolean; correct: number; total: number };
}

/**
 * A scenario played locally from the downloaded graph (docs/16 §7): the
 * choice path is replayed on sync (`POST /scenarios/:id/complete` with the
 * Idempotency-Key), where the server walks and scores it again.
 */
export interface QueuedScenarioComplete extends QueuedEventBase {
  kind: 'scenario_complete';
  lessonId: string;
  scenarioId: string;
  chosenPath: string[];
  /** Local walk result (display only — the server re-scores). */
  rubricScore?: { depth: number; outcome: string | null; completed: boolean };
}

/** Offline re-equip from owned items (docs/16 §3, LWW by clientTimestamp). */
export interface QueuedAvatarEquip extends QueuedEventBase {
  kind: 'avatar_equip';
  /**
   * Latest change per slot; `itemId: null` unequips. `at` = when that
   * slot was changed (epoch ms) — the slot's own LWW clock on replay;
   * older queues without it use the event's `clientTimestamp`.
   */
  slotChanges: { slot: string; itemId: string | null; at?: number }[];
}

/** Offline avatar config edit (docs/16 §8, LWW by clientTimestamp). */
export interface QueuedAvatarConfig extends QueuedEventBase {
  kind: 'avatar_config_update';
  config: Record<string, unknown>;
}

/** A lesson opened offline — reported on sync (analytics / resume). */
export interface QueuedLessonSeen extends QueuedEventBase {
  kind: 'lesson_progress_seen';
  lessonId: string;
  courseId?: string;
}

/** Offline settings change replayed as `PATCH /me` (latest wins). */
export interface QueuedPreferenceUpdate extends QueuedEventBase {
  kind: 'preference_update';
  prefs: PreferencePatch;
}

/** The `PATCH /me` fields a device may change offline. */
export interface PreferencePatch {
  locale?: string;
  timezone?: string;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  marketingEmailOptIn?: boolean;
}

export type QueuedEvent =
  | QueuedLessonComplete
  | QueuedQuizAttempt
  | QueuedScenarioComplete
  | QueuedAvatarEquip
  | QueuedAvatarConfig
  | QueuedLessonSeen
  | QueuedPreferenceUpdate;

/** Kinds that complete (or grade) a lesson — they show the pending clock. */
export const LESSON_COMPLETION_KINDS: readonly QueuedEventKind[] = [
  'lesson_complete',
  'quiz_attempt',
  'scenario_complete',
];

/** The lesson an event is about, if any. */
export function eventLessonId(ev: QueuedEvent): string | null {
  return 'lessonId' in ev ? ev.lessonId : null;
}
export type QueuedEventKind = QueuedEvent['kind'];

/** Persistence seam for the queue (IndexedDB in the app, memory in tests). */
export interface EventQueueStore {
  enqueue(ev: QueuedEvent): Promise<void>;
  /** Oldest-first by clientTimestamp. */
  list(): Promise<QueuedEvent[]>;
  remove(clientEventId: string): Promise<void>;
  update(ev: QueuedEvent): Promise<void>;
  /** Drop everything for a given user. Returns how many were removed. */
  clearForUser(userId: string): Promise<number>;
  /** Drop every event NOT belonging to `userId` (different-user sign-in). */
  clearOtherUsers(userId: string): Promise<number>;
  size(): Promise<number>;
}

function removeWhere(pred: (ev: QueuedEvent) => boolean): Promise<number> {
  return tx<number>(idbStores.STORE_QUEUE, 'readwrite', (s) => {
    return new Promise<number>((resolve, reject) => {
      let removed = 0;
      const req = s.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(removed);
        if (pred(cur.value as QueuedEvent)) {
          cur.delete();
          removed += 1;
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export const EventQueue: EventQueueStore = {
  async enqueue(ev) {
    await tx<IDBValidKey>(idbStores.STORE_QUEUE, 'readwrite', (s) => s.put(ev));
  },

  list() {
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

  async remove(clientEventId) {
    await tx<undefined>(idbStores.STORE_QUEUE, 'readwrite', (s) =>
      s.delete(clientEventId),
    );
  },

  async update(ev) {
    await tx<IDBValidKey>(idbStores.STORE_QUEUE, 'readwrite', (s) => s.put(ev));
  },

  clearForUser(userId) {
    return removeWhere((ev) => ev.userId === userId);
  },

  clearOtherUsers(userId) {
    return removeWhere((ev) => ev.userId !== userId);
  },

  size() {
    return tx<number>(idbStores.STORE_QUEUE, 'readonly', (s) => {
      const req = s.count();
      return req as unknown as IDBRequest<number>;
    });
  },
};

/** DI seam so the sync service can be unit-tested without IndexedDB. */
export const EVENT_QUEUE_STORE = new InjectionToken<EventQueueStore>(
  'EVENT_QUEUE_STORE',
  { providedIn: 'root', factory: () => EventQueue },
);

/** In-memory store (tests, and the fallback when IndexedDB is blocked). */
export function createMemoryQueueStore(
  initial: QueuedEvent[] = [],
): EventQueueStore {
  let rows = initial.map((e) => ({ ...e }));
  const sorted = () =>
    [...rows]
      .sort((a, b) => a.clientTimestamp - b.clientTimestamp)
      .map((e) => ({ ...e }));
  return {
    async enqueue(ev) {
      rows = rows.filter((r) => r.clientEventId !== ev.clientEventId);
      rows.push({ ...ev });
    },
    async list() {
      return sorted();
    },
    async remove(id) {
      rows = rows.filter((r) => r.clientEventId !== id);
    },
    async update(ev) {
      rows = rows.map((r) =>
        r.clientEventId === ev.clientEventId ? { ...ev } : r,
      );
    },
    async clearForUser(userId) {
      const before = rows.length;
      rows = rows.filter((r) => r.userId !== userId);
      return before - rows.length;
    },
    async clearOtherUsers(userId) {
      const before = rows.length;
      rows = rows.filter((r) => r.userId === userId);
      return before - rows.length;
    },
    async size() {
      return rows.length;
    },
  };
}

/** UUID v4. Avoids importing from api-client to keep this lib browser-only. */
export function newClientEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback: math-random UUID — only used in environments without webcrypto.
  let n = '';
  for (let i = 0; i < 32; i += 1)
    n += Math.floor(Math.random() * 16).toString(16);
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
