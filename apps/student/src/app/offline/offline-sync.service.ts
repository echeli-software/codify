import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  GamificationClient,
  ProblemDetailsError,
  ProgressClient,
  QuizzesClient,
  toProblemDetails,
  type CompleteLessonResponse,
  type QuizAttemptResult,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { I18nService } from '@codify/i18n';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { checkQuizAnswerHash } from '@codify/lesson-schema';
import {
  AppToastService,
  errorMessageKey,
} from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { DownloadService } from './download.service.js';
import {
  EVENT_QUEUE_STORE,
  newClientEventId,
  type QueuedEvent,
  type QueuedLessonComplete,
  type QueuedQuizAttempt,
} from './event-queue.js';
import { IdentityCacheService } from './identity-cache.service.js';
import { NetworkStatusService } from './network-status.service.js';

/** First retry delay; doubles per attempt up to the cap. */
export const SYNC_BASE_DELAY_MS = 2_000;
export const SYNC_MAX_DELAY_MS = 5 * 60_000;
/** After this many failed automatic attempts an event needs a manual retry. */
export const SYNC_MAX_ATTEMPTS = 8;

/**
 * Exponential backoff with "equal jitter": half the exponential delay is
 * fixed, the other half random, so retries from many devices spread out
 * but never fire immediately.
 */
export function backoffDelay(
  attempts: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(
    SYNC_MAX_DELAY_MS,
    SYNC_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
  );
  return Math.round(exp / 2 + (rand() * exp) / 2);
}

/**
 * How a failed sync request is handled (docs/16 §7):
 *   - reconcile  409 domain-already-applied → drop + reconcile
 *   - paywall    402 → drop + surface the paywall
 *   - rejected   400/403/404 (and other permanent 4xx) → drop + error toast
 *   - timestamp  400 on clientTimestamp → replay once without it
 *   - auth       401 → keep, halt the flush until the same user signs in
 *   - retry      network / 408 / 429 / 5xx → keep, exponential backoff
 */
export type SyncFailure =
  | 'reconcile'
  | 'paywall'
  | 'rejected'
  | 'timestamp'
  | 'auth'
  | 'retry';

const TIMESTAMP_CODES = new Set([
  'CLIENT_TIMESTAMP_TOO_OLD',
  'CLIENT_TIMESTAMP_IN_FUTURE',
  'INVALID_CLIENT_TIMESTAMP',
]);
/** 409s that mean "this request can never succeed", not "already applied". */
const NON_RECONCILABLE_CONFLICTS = new Set([
  'LESSON_COMPLETES_VIA_OWN_FLOW',
  'QUIZ_REQUIRES_GRADING',
]);

export function classifySyncFailure(err: unknown): SyncFailure {
  const p = toProblemDetails(err);
  const s = p.status;
  if (s === 0 || s === 408 || s === 429 || s >= 500) return 'retry';
  if (s === 401) return 'auth';
  if (s === 402) return 'paywall';
  if (s === 409) {
    return p.code && NON_RECONCILABLE_CONFLICTS.has(p.code)
      ? 'rejected'
      : 'reconcile';
  }
  if (s === 400 && p.code && TIMESTAMP_CODES.has(p.code)) return 'timestamp';
  return 'rejected';
}

/**
 * Result of completing a lesson via the offline-aware path.
 *
 *   - `synced`    server accepted and returned the canonical payload.
 *   - `conflict`  server already had it (409); the queue entry is dropped
 *                 and the original payload surfaced so the UI can mark the
 *                 lesson complete without crediting twice.
 *   - `queued`    offline, signed-out/expired session, or a retryable
 *                 failure; the event sits in the queue for the next flush.
 *   - `paywall`   402 — the user lost access; show the paywall. Dropped.
 *   - `rejected`  permanent 4xx (403/404/400); dropped. `messageKey` is a
 *                 `studentPlatform.errors.*` key for the UI.
 */
export type CompleteOutcome =
  | { status: 'synced'; response: CompleteLessonResponse }
  | { status: 'conflict'; response: CompleteLessonResponse }
  | { status: 'queued'; clientEventId: string }
  | { status: 'paywall'; lessonId: string; error: ProblemDetailsError }
  | {
      status: 'rejected';
      lessonId: string;
      error: ProblemDetailsError;
      messageKey: string;
    };

/** Local (offline) grading of a quiz attempt against the bundle hashes. */
export interface LocalQuizCheck {
  allCorrect: boolean;
  correct: number;
  total: number;
}

export type QuizSubmitOutcome =
  | { status: 'graded'; result: QuizAttemptResult }
  | { status: 'queued'; clientEventId: string; localCheck?: LocalQuizCheck };

export interface LessonReconciled {
  lessonId: string;
  response: CompleteLessonResponse;
  via: 'synced' | 'conflict';
  clientEventId: string;
}

export interface QuizReconciled {
  lessonId: string;
  result: QuizAttemptResult;
  clientEventId: string;
  localCheck?: LocalQuizCheck;
}

export interface FlushResult {
  synced: number;
  dropped: number;
  remaining: number;
}

interface ConflictBody {
  progress?: CompleteLessonResponse['progress'];
  totals?: CompleteLessonResponse['totals'];
}

type SendResult =
  | {
      next: 'continue';
      outcome: CompleteOutcome | QuizSubmitOutcome;
      synced: boolean;
    }
  | { next: 'halt'; outcome: CompleteOutcome | QuizSubmitOutcome };

/**
 * Offline-aware orchestrator for lesson completions and quiz attempts
 * (docs/16 §7–§8). Every mutation goes through the queue:
 *
 *   - Enqueue first (a crash mid-POST leaves the event persisted), then
 *     POST with `Idempotency-Key: clientEventId` and `clientTimestamp`.
 *   - The queue is per user: a flush only sends the signed-in user's
 *     events; a different user's sign-in discards the previous user's
 *     events with an explanatory toast; an explicit sign-out clears them
 *     (`clearForUser`). A forced sign-out (expired session / 401) keeps the
 *     queue and blocks flushing until the same user signs in again.
 *   - Retryable failures back off exponentially with jitter, up to
 *     `SYNC_MAX_ATTEMPTS`; then the event is `stuck` until a manual retry.
 *   - Flushes run on: boot, offline → online, sign-in, backoff timers and
 *     "Sync now" — never as a reaction to the queue itself changing (that
 *     was the old re-fire loop).
 */
@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly progressClient = inject(ProgressClient);
  private readonly quizzes = inject(QuizzesClient);
  private readonly gamification = inject(GamificationClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly store = inject(EVENT_QUEUE_STORE);
  private readonly downloads = inject(DownloadService);
  private readonly identity = inject(IdentityCacheService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);

  private readonly _events = signal<QueuedEvent[]>([]);
  private readonly _flushing = signal(false);
  private readonly _lastError = signal<string | null>(null);
  private readonly _authBlocked = signal(false);
  private readonly _paywall = signal<{ lessonId: string; at: number } | null>(
    null,
  );
  private readonly _lessonReconciled = signal<LessonReconciled | null>(null);
  private readonly _quizReconciled = signal<QuizReconciled | null>(null);

  private readonly ready: Promise<void>;
  private inFlight: Promise<FlushResult> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private knownUserId: string | null | undefined = undefined;
  private wasOnline: boolean | undefined = undefined;

  /** The signed-in user's pending events, oldest first. */
  readonly pending = computed(() => {
    const uid = this.auth.user()?.id;
    return uid ? this._events().filter((e) => e.userId === uid) : [];
  });
  readonly pendingCount = computed(() => this.pending().length);
  /** Events that exhausted automatic retries (need "Retry" or "Discard"). */
  readonly stuckCount = computed(
    () => this.pending().filter((e) => e.stuck).length,
  );
  readonly flushing = this._flushing.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  /** True after a 401: the queue waits for the same user to sign in again. */
  readonly authBlocked = this._authBlocked.asReadonly();
  /** Set when a background sync hit a 402 — pages can open the paywall. */
  readonly paywall = this._paywall.asReadonly();
  /** Latest reconciliation per event kind — pages refresh their UI on it. */
  readonly lastReconciled = {
    lessonComplete: this._lessonReconciled.asReadonly(),
    quizAttempt: this._quizReconciled.asReadonly(),
  };
  /** Back-compat alias of `lastReconciled.lessonComplete`. */
  readonly reconciled = this._lessonReconciled.asReadonly();

  constructor() {
    this.ready = this.prime();

    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => void this.onUserChanged(id));
    });

    effect(() => {
      const online = this.network.online();
      untracked(() => {
        const cameOnline = online && this.wasOnline !== true;
        this.wasOnline = online;
        if (cameOnline) void this.flush();
        if (!online) this.clearRetryTimer();
      });
    });

    inject(DestroyRef).onDestroy(() => this.clearRetryTimer());
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Complete a lesson, choosing the right path automatically. The queue
   * entry is written before the POST; the server's `(userId, lessonId)`
   * unique constraint + Idempotency-Key make a replay a 409 no-op.
   */
  async completeLesson(
    lessonId: string,
    opts: { title?: string } = {},
  ): Promise<CompleteOutcome> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    await this.ready;

    const existing = this._events().find(
      (e): e is QueuedLessonComplete =>
        e.kind === 'lesson_complete' &&
        e.userId === userId &&
        e.lessonId === lessonId,
    );
    const ev: QueuedLessonComplete = existing ?? {
      kind: 'lesson_complete',
      clientEventId: newClientEventId(),
      clientTimestamp: Date.now(),
      userId,
      lessonId,
      attempts: 0,
      ...(opts.title ? { lessonTitle: opts.title } : {}),
    };
    if (!existing) {
      await this.store.enqueue(ev);
      await this.refresh();
    }

    if (!this.network.online() || this._authBlocked()) {
      return { status: 'queued', clientEventId: ev.clientEventId };
    }
    const res = await this.send(ev, true);
    this.scheduleRetry();
    return res.outcome as CompleteOutcome;
  }

  /**
   * Submit quiz answers. Online → graded by the server (errors such as 402
   * or 429 `QUIZ_ATTEMPT_COOLDOWN` are thrown as `ProblemDetailsError`).
   * Offline (or the request never reached the server) → checked locally
   * against the downloaded bundle's answer hashes, queued with its
   * clientTimestamp and graded for real on sync. Only the best local
   * attempt per lesson is kept in the queue (docs/16 §8).
   */
  async submitQuiz(
    lessonId: string,
    answers: Record<string, string[]>,
  ): Promise<QuizSubmitOutcome> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    await this.ready;
    const clientTimestamp = Date.now();

    if (this.network.online() && !this._authBlocked()) {
      try {
        const result = await this.quizzes.submit(lessonId, answers, {
          clientTimestamp: new Date(clientTimestamp).toISOString(),
        });
        this.telemetry.track('quiz_submitted', {
          lessonId,
          scorePct: result.scorePct,
          passed: result.passed,
          offline: false,
        });
        return { status: 'graded', result };
      } catch (err) {
        if (classifySyncFailure(err) !== 'retry') throw err;
        // The request never landed (network / 5xx): fall back to the queue.
      }
    }

    const localCheck = await this.localCheck(lessonId, answers);
    const existing = this._events().find(
      (e): e is QueuedQuizAttempt =>
        e.kind === 'quiz_attempt' &&
        e.userId === userId &&
        e.lessonId === lessonId,
    );
    if (existing && !isBetter(localCheck, existing.localCheck)) {
      return {
        status: 'queued',
        clientEventId: existing.clientEventId,
        localCheck,
      };
    }
    const ev: QueuedQuizAttempt = {
      kind: 'quiz_attempt',
      clientEventId: existing?.clientEventId ?? newClientEventId(),
      clientTimestamp,
      userId,
      lessonId,
      answers,
      attempts: 0,
      ...(localCheck ? { localCheck } : {}),
    };
    await this.store.enqueue(ev);
    await this.refresh();
    this.telemetry.track('quiz_submitted', {
      lessonId,
      offline: true,
      localAllCorrect: localCheck?.allCorrect ?? null,
    });
    this.scheduleRetry();
    return { status: 'queued', clientEventId: ev.clientEventId, localCheck };
  }

  /**
   * Drain the signed-in user's queue FIFO. Concurrent calls share one run.
   * `manual` (Sync now) also retries events in backoff or marked stuck and
   * lifts an auth block (the request will tell us if it's still bad).
   * Never rejects.
   */
  flush(opts: { manual?: boolean } = {}): Promise<FlushResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doFlush(opts.manual === true)
      .catch((err: unknown) => {
        this._lastError.set(describe(err));
        return { synced: 0, dropped: 0, remaining: this.pendingCount() };
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Last-resort removal of a stuck event (Sync sheet, with confirm). */
  async discard(clientEventId: string): Promise<void> {
    const ev = this._events().find((e) => e.clientEventId === clientEventId);
    await this.store.remove(clientEventId);
    await this.refresh();
    if (ev)
      this.telemetry.track('sync_event_discarded', {
        kind: ev.kind,
        attempts: ev.attempts,
      });
  }

  /** Explicit sign-out: drop this user's queue (docs/16 §4 "Sign-out"). */
  async clearForUser(userId: string): Promise<number> {
    await this.ready;
    const removed = await this.store.clearForUser(userId);
    this._authBlocked.set(false);
    this.clearRetryTimer();
    await this.refresh();
    return removed;
  }

  /** Force a re-read of the queue from disk. */
  async refresh(): Promise<void> {
    try {
      this._events.set(await this.store.list());
    } catch (err) {
      this._lastError.set(describe(err));
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async prime(): Promise<void> {
    try {
      this._events.set(await this.store.list());
    } catch (err) {
      // IndexedDB unavailable (private mode / blocked storage): pure-online mode.
      this._lastError.set(`offline queue unavailable: ${describe(err)}`);
    }
  }

  private async onUserChanged(id: string | null): Promise<void> {
    const previous = this.knownUserId;
    this.knownUserId = id;
    if (previous === id) return;
    if (!id) {
      // Signed out — explicitly (the session service already cleared the
      // queue) or forced by an expired session (keep it for the same user).
      this.clearRetryTimer();
      return;
    }
    await this.ready;
    try {
      const removed = await this.store.clearOtherUsers(id);
      if (removed > 0) {
        this.toast.show({
          message: 'studentPlatform.sync.discardedOtherUser',
          params: { count: removed },
          kind: 'warning',
          durationMs: 10_000,
        });
        this.telemetry.track('sync_queue_discarded', {
          count: removed,
          reason: 'different_user',
        });
      }
    } catch (err) {
      this._lastError.set(describe(err));
    }
    this._authBlocked.set(false);
    await this.refresh();
    if (this.network.online()) void this.flush();
  }

  private async doFlush(manual: boolean): Promise<FlushResult> {
    await this.ready;
    const userId = this.auth.user()?.id;
    const empty = { synced: 0, dropped: 0, remaining: this.pendingCount() };
    if (!userId || !this.network.online()) return empty;
    if (this._authBlocked() && !manual) return empty;

    const events = (await this.store.list()).filter((e) => e.userId === userId);
    const now = Date.now();
    const due = events.filter(
      (e) => manual || (!e.stuck && (e.nextAttemptAt ?? 0) <= now),
    );
    if (due.length === 0) {
      this.scheduleRetry();
      return { ...empty, remaining: events.length };
    }

    this._flushing.set(true);
    this._lastError.set(null);
    if (manual) this._authBlocked.set(false);
    const started = Date.now();
    this.telemetry.track('sync_flush_started', {
      queueDepth: events.length,
      manual,
    });
    let synced = 0;
    let dropped = 0;
    let halted = false;
    try {
      for (const ev of due) {
        if (!this.network.online() || this.auth.user()?.id !== userId) {
          halted = true;
          break;
        }
        const res = await this.send(ev, false);
        if (res.next === 'halt') {
          halted = true;
          break;
        }
        if (res.synced) synced += 1;
        else dropped += 1;
      }
    } finally {
      this._flushing.set(false);
      await this.refresh();
      this.scheduleRetry();
    }

    const remaining = this.pendingCount();
    this.telemetry.track(
      halted ? 'sync_flush_failed' : 'sync_flush_completed',
      {
        synced,
        dropped,
        remaining,
        durationMs: Date.now() - started,
      },
    );
    if (synced > 0) void this.reconcileTotals();
    return { synced, dropped, remaining };
  }

  /**
   * POST one event and apply the outcome to the queue. `foreground` calls
   * come from a page awaiting the result (no toast — the page reacts).
   */
  private async send(
    ev: QueuedEvent,
    foreground: boolean,
  ): Promise<SendResult> {
    const opts = ev.dropTimestamp
      ? {}
      : { clientTimestamp: new Date(ev.clientTimestamp).toISOString() };
    try {
      if (ev.kind === 'lesson_complete') {
        const response = await this.progressClient.complete(
          ev.lessonId,
          ev.clientEventId,
          opts,
        );
        await this.store.remove(ev.clientEventId);
        await this.refresh();
        this._lessonReconciled.set({
          lessonId: ev.lessonId,
          response,
          via: 'synced',
          clientEventId: ev.clientEventId,
        });
        return {
          next: 'continue',
          synced: true,
          outcome: { status: 'synced', response },
        };
      }
      const result = await this.quizzes.submit(ev.lessonId, ev.answers, opts);
      await this.store.remove(ev.clientEventId);
      await this.refresh();
      this._quizReconciled.set({
        lessonId: ev.lessonId,
        result,
        clientEventId: ev.clientEventId,
        localCheck: ev.localCheck,
      });
      if (!foreground) {
        this.toast.show({
          message: result.passed
            ? 'studentPlatform.sync.quizPassed'
            : 'studentPlatform.sync.quizFailed',
          params: { score: result.scorePct },
          kind: result.passed ? 'success' : 'info',
        });
      }
      return {
        next: 'continue',
        synced: true,
        outcome: { status: 'graded', result },
      };
    } catch (err) {
      return this.handleFailure(ev, err, foreground);
    }
  }

  private async handleFailure(
    ev: QueuedEvent,
    err: unknown,
    foreground: boolean,
  ): Promise<SendResult> {
    const problem = toProblemDetails(err);
    const kind = classifySyncFailure(problem);
    const queued = {
      status: 'queued' as const,
      clientEventId: ev.clientEventId,
    };

    switch (kind) {
      case 'timestamp': {
        if (ev.dropTimestamp) break; // already replayed without it → rejected below
        const replay = { ...ev, dropTimestamp: true };
        await this.store.update(replay);
        return this.send(replay, foreground);
      }
      case 'reconcile': {
        await this.store.remove(ev.clientEventId);
        await this.refresh();
        if (ev.kind === 'lesson_complete') {
          const cb = (problem.data ?? {}) as ConflictBody;
          const response: CompleteLessonResponse = {
            progress: cb.progress ?? {
              lessonId: ev.lessonId,
              completedAt: new Date(ev.clientTimestamp).toISOString(),
              xpAwarded: 0,
              coinsAwarded: 0,
            },
            totals: cb.totals ?? { totalXp: 0, coins: 0 },
          };
          this._lessonReconciled.set({
            lessonId: ev.lessonId,
            response,
            via: 'conflict',
            clientEventId: ev.clientEventId,
          });
          return {
            next: 'continue',
            synced: true,
            outcome: { status: 'conflict', response },
          };
        }
        return { next: 'continue', synced: true, outcome: queued };
      }
      case 'auth': {
        this._authBlocked.set(true);
        await this.store.update({ ...ev, lastError: describe(problem) });
        await this.refresh();
        this._lastError.set(describe(problem));
        if (!foreground) {
          this.toast.show({
            message: 'studentPlatform.sync.signInAgain',
            kind: 'warning',
          });
        }
        return { next: 'halt', outcome: queued };
      }
      case 'retry': {
        const attempts = ev.attempts + 1;
        const updated: QueuedEvent = {
          ...ev,
          attempts,
          lastError: describe(problem),
          nextAttemptAt: Date.now() + backoffDelay(attempts),
          stuck: attempts >= SYNC_MAX_ATTEMPTS,
        };
        await this.store.update(updated);
        await this.refresh();
        this._lastError.set(updated.lastError ?? null);
        return { next: 'halt', outcome: queued };
      }
      default:
        break;
    }

    // paywall / rejected: drop the event — retrying can never succeed.
    await this.store.remove(ev.clientEventId);
    await this.refresh();
    const reason = kind === 'paywall' ? 'paywall' : `http_${problem.status}`;
    this.telemetry.track('sync_event_dropped', {
      kind: ev.kind,
      reason,
      code: problem.code ?? null,
    });
    if (kind === 'paywall') {
      this._paywall.set({ lessonId: ev.lessonId, at: Date.now() });
      if (!foreground) {
        this.toast.show({
          message: 'studentPlatform.sync.paywall',
          kind: 'warning',
        });
      }
      return {
        next: 'continue',
        synced: false,
        outcome: { status: 'paywall', lessonId: ev.lessonId, error: problem },
      };
    }
    const messageKey = errorMessageKey(problem);
    if (!foreground) {
      this.toast.show({
        message: 'studentPlatform.sync.dropped',
        params: { reason: this.i18n.t(messageKey) },
        kind: 'error',
      });
    }
    return {
      next: 'continue',
      synced: false,
      outcome: {
        status: 'rejected',
        lessonId: ev.lessonId,
        error: problem,
        messageKey,
      },
    };
  }

  /** Single "state reconcile" GET after a flush (docs/16 §7). */
  private async reconcileTotals(): Promise<void> {
    try {
      const s = await this.gamification.summary();
      this.orchestrator.reconcile({
        totalXp: s.totalXp,
        coins: s.coins,
        level: s.level,
        streakDays: s.streak.currentDays,
        freezesAvailable: s.streak.freezesAvailable,
        bestDays: s.streak.longestDays,
      });
      await this.identity.patch({
        totalXp: s.totalXp,
        coins: s.coins,
        level: s.level,
      });
    } catch {
      /* next boot / flush reconciles */
    }
  }

  private async localCheck(
    lessonId: string,
    answers: Record<string, string[]>,
  ): Promise<LocalQuizCheck | undefined> {
    try {
      const bundle = await this.downloads.getLessonBundle(lessonId);
      const keys = bundle?.quizAnswerHashes;
      const ids = keys ? Object.keys(keys.hashes) : [];
      if (!keys || ids.length === 0) return undefined;
      let correct = 0;
      for (const id of ids) {
        if (
          await checkQuizAnswerHash(
            keys.hashes[id] ?? '',
            keys.salt,
            id,
            answers[id] ?? [],
          )
        ) {
          correct += 1;
        }
      }
      return { allCorrect: correct === ids.length, correct, total: ids.length };
    } catch {
      return undefined;
    }
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    if (!this.network.online() || this._authBlocked()) return;
    const waits = this.pending()
      .filter((e) => !e.stuck)
      .map((e) => e.nextAttemptAt ?? 0);
    if (waits.length === 0) return;
    const delay = Math.max(500, Math.min(...waits) - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

function isBetter(
  next: LocalQuizCheck | undefined,
  prev: LocalQuizCheck | undefined,
): boolean {
  if (!prev) return true;
  if (!next) return false;
  // Ties: the latest attempt replaces the older one (docs/16 §8).
  return next.correct >= prev.correct;
}

function describe(err: unknown): string {
  if (err instanceof ProblemDetailsError)
    return `HTTP ${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
