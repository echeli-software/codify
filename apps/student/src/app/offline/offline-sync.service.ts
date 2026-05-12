import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  ProblemDetailsError,
  ProgressClient,
  type CompleteLessonResponse,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { EventQueue, newClientEventId, type QueuedEvent } from './event-queue.js';
import { NetworkStatusService } from './network-status.service.js';

/**
 * Result of completing a lesson via the offline-aware path.
 *
 *   - `synced`    server accepted (201) and returned the canonical payload.
 *   - `conflict`  server already had it (409); we drop the queue entry
 *                 and surface the original payload so the UI can mark
 *                 the lesson complete without crediting twice.
 *   - `queued`    no network or POST failed; event sits in the queue
 *                 for the next flush.  UI may show an optimistic
 *                 "Completed" state with a "will sync" badge.
 */
export type CompleteOutcome =
  | { status: 'synced'; response: CompleteLessonResponse }
  | { status: 'conflict'; response: CompleteLessonResponse }
  | { status: 'queued'; clientEventId: string };

interface ConflictBody {
  progress?: CompleteLessonResponse['progress'];
  totals?: CompleteLessonResponse['totals'];
}

/**
 * Offline-aware orchestrator for lesson completions (and, later,
 * scenario/avatar/etc events).  Wraps `ProgressClient` so callers
 * always go through the queue path:
 *
 *   - Online happy path: enqueue → POST → on 201 remove → return synced.
 *   - Online 409: enqueue → POST → 409 → remove + return conflict
 *     so the UI can reconcile (server already has it).
 *   - Offline or failed POST: event sits in the queue; the
 *     online-event listener auto-flushes when connectivity returns.
 *
 * Always enqueue first so a crash between "POST sent" and "response
 * received" still leaves the event in the queue for retry — the
 * server-side (userId, lessonId) unique constraint makes that safe.
 *
 * The service also exposes reactive signals (`pending()`, `flushing()`,
 * `lastError()`) for the offline indicator chip + Sync now sheet.
 */
@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly progressClient = inject(ProgressClient);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);

  private readonly _pending = signal<QueuedEvent[]>([]);
  private readonly _flushing = signal(false);
  private readonly _lastError = signal<string | null>(null);
  private hasPrimed = false;
  /** Listeners notified after a 2xx OR 409 lands for a given lesson. */
  private readonly lessonReconciled = signal<{
    lessonId: string;
    response: CompleteLessonResponse;
    via: 'synced' | 'conflict';
  } | null>(null);

  /** Pending events oldest-first. */
  readonly pending = this._pending.asReadonly();
  readonly pendingCount = computed(() => this._pending().length);
  readonly flushing = this._flushing.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  /** Last "lesson reconciled" signal — pages listen to refresh their UI. */
  readonly reconciled = this.lessonReconciled.asReadonly();

  constructor() {
    void this.prime();
    // Auto-flush whenever connectivity returns *and* we have things to send.
    effect(() => {
      const online = this.network.online();
      const count = this._pending().length;
      if (online && count > 0 && !this._flushing()) {
        void this.flush();
      }
    });
  }

  /**
   * Read the queue from IndexedDB into the in-memory pending signal.
   * Call once on app boot; subsequent enqueue/remove calls keep the
   * signal in sync without re-reading.
   */
  private async prime(): Promise<void> {
    if (this.hasPrimed) return;
    this.hasPrimed = true;
    try {
      const list = await EventQueue.list();
      this._pending.set(list);
    } catch (err) {
      // IndexedDB may be unavailable (private mode, blocked storage); the
      // app still functions in pure-online mode.
      this._lastError.set(`offline queue unavailable: ${describe(err)}`);
    }
  }

  /**
   * Complete a lesson, choosing the right path automatically.
   *
   * The queue entry is written *before* the POST so a process crash
   * mid-POST leaves the event safely persisted.  The server's unique
   * constraint on `(userId, lessonId)` means the retry returns 409
   * (a no-op for the totals) rather than double-awarding.
   */
  async completeLesson(lessonId: string): Promise<CompleteOutcome> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');

    const ev: QueuedEvent = {
      kind: 'lesson_complete',
      clientEventId: newClientEventId(),
      clientTimestamp: Date.now(),
      userId,
      lessonId,
      attempts: 0,
    };
    await EventQueue.enqueue(ev);
    this._pending.set(await EventQueue.list());

    if (!this.network.online()) {
      return { status: 'queued', clientEventId: ev.clientEventId };
    }

    return this.attempt(ev);
  }

  /** Drains the queue FIFO. Safe to call concurrently — no-ops if already running. */
  async flush(): Promise<void> {
    if (this._flushing()) return;
    if (!this.network.online()) return;
    this._flushing.set(true);
    this._lastError.set(null);
    try {
      let pending = await EventQueue.list();
      while (pending.length > 0 && this.network.online()) {
        const ev = pending[0];
        const out = await this.attempt(ev);
        if (out.status === 'queued') {
          // Keep in queue; bail to wait for next online + retry.
          break;
        }
        pending = await EventQueue.list();
      }
    } finally {
      this._flushing.set(false);
    }
  }

  /**
   * Issue the actual POST for one event. Updates the queue + pending
   * signal based on outcome.  Returns the synthesized CompleteOutcome
   * for the UI to act on (the queued case is purely metadata — the
   * caller usually treats it the same as synced for optimistic UX).
   */
  private async attempt(ev: QueuedEvent): Promise<CompleteOutcome> {
    try {
      const res = await this.progressClient.complete(
        ev.lessonId,
        ev.clientEventId,
      );
      await EventQueue.remove(ev.clientEventId);
      this._pending.set(await EventQueue.list());
      this.lessonReconciled.set({
        lessonId: ev.lessonId,
        response: res,
        via: 'synced',
      });
      return { status: 'synced', response: res };
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isConflict) {
        // Server already has it. Pull canonical payload from data[]
        // (extra body fields the api-client preserves) and reconcile.
        const cb = (err.data ?? {}) as ConflictBody;
        const response: CompleteLessonResponse = {
          progress: cb.progress ?? {
            lessonId: ev.lessonId,
            completedAt: new Date(ev.clientTimestamp).toISOString(),
            xpAwarded: 0,
            coinsAwarded: 0,
          },
          totals: cb.totals ?? { totalXp: 0, coins: 0 },
        };
        await EventQueue.remove(ev.clientEventId);
        this._pending.set(await EventQueue.list());
        this.lessonReconciled.set({
          lessonId: ev.lessonId,
          response,
          via: 'conflict',
        });
        return { status: 'conflict', response };
      }
      // 5xx / network / 401 — leave in queue with attempts++, surface error.
      const updated: QueuedEvent = {
        ...ev,
        attempts: ev.attempts + 1,
        lastError: describe(err),
      };
      await EventQueue.update(updated);
      this._pending.set(await EventQueue.list());
      this._lastError.set(updated.lastError ?? null);
      return { status: 'queued', clientEventId: ev.clientEventId };
    }
  }

  /** Force a re-read of the queue from disk. Used by tests + Sync sheet. */
  async refresh(): Promise<void> {
    this._pending.set(await EventQueue.list());
  }
}

function describe(err: unknown): string {
  if (err instanceof ProblemDetailsError) return `HTTP ${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
