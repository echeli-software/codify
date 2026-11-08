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
  ItemsClient,
  MeClient,
  ProblemDetailsError,
  ProgressClient,
  QuizzesClient,
  ScenariosClient,
  toProblemDetails,
  type AvatarResponse,
  type CompleteLessonResponse,
  type CompleteResult as ScenarioCompleteResult,
  type ItemSlot,
  type QuizAttemptResult,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { I18nService } from '@codify/i18n';
import { RewardOrchestrator } from '@codify/gamification-engine';
import {
  AppToastService,
  errorMessageKey,
} from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { DownloadService } from './download.service.js';
import {
  EVENT_QUEUE_STORE,
  LESSON_COMPLETION_KINDS,
  eventLessonId,
  newClientEventId,
  type PreferencePatch,
  type QueuedAvatarConfig,
  type QueuedAvatarEquip,
  type QueuedEvent,
  type QueuedLessonComplete,
  type QueuedLessonSeen,
  type QueuedPreferenceUpdate,
  type QueuedQuizAttempt,
  type QueuedScenarioComplete,
} from './event-queue.js';
import { IdentityCacheService } from './identity-cache.service.js';
import { checkQuizAnswer } from './quiz-hash.js';
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
 *   - timestamp  400 on clientTimestamp → replay once without it (the API
 *                clamps old / future times to "now" since docs/16 §8, so
 *                only an unparseable value — or an older API — gets here)
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

/** Result of finishing a scenario play-through (docs/16 §7). */
export type ScenarioCompleteOutcome =
  | { status: 'synced'; result: ScenarioCompleteResult }
  | { status: 'queued'; clientEventId: string };

export interface ScenarioReconciled {
  lessonId: string;
  result: ScenarioCompleteResult;
  clientEventId: string;
}

/** Offline estimate on top of the canonical totals (docs/16 §8). */
export interface PendingEstimate {
  xp: number;
  coins: number;
  /** Queued lesson completions (lesson / quiz / scenario). */
  lessons: number;
  /** …of which are exercise-free lesson completions for quest progress. */
  lessonIds: string[];
}

/** Sum the local reward estimates of queued completions. */
export function estimatePending(
  events: readonly QueuedEvent[],
): PendingEstimate {
  const ids = new Set<string>();
  let xp = 0;
  let coins = 0;
  for (const e of events) {
    if (!LESSON_COMPLETION_KINDS.includes(e.kind)) continue;
    const id = eventLessonId(e);
    if (!id || ids.has(id)) continue;
    // A queued quiz attempt only counts when the local check passed.
    if (e.kind === 'quiz_attempt' && !e.localCheck?.allCorrect) continue;
    if (e.kind === 'scenario_complete' && e.rubricScore?.completed === false)
      continue;
    ids.add(id);
    xp += e.estimate?.xp ?? 0;
    coins += e.estimate?.coins ?? 0;
  }
  return { xp, coins, lessons: ids.size, lessonIds: [...ids] };
}

type SlotChange = { slot: string; itemId: string | null; at?: number };

/**
 * Merge per-slot equip changes: the latest change of a slot wins. `at`
 * (epoch ms) stamps the `next` changes with their own time, so each slot
 * replays with the time it was changed — not the time of the last edit to
 * any slot (docs/16 §8, LRN-2).
 */
export function mergeSlotChanges(
  prev: readonly SlotChange[],
  next: readonly { slot: string; itemId: string | null }[],
  at?: number,
): SlotChange[] {
  const map = new Map(prev.map((c) => [c.slot, c]));
  for (const c of next)
    map.set(c.slot, {
      slot: c.slot,
      itemId: c.itemId,
      ...(at === undefined ? {} : { at }),
    });
  return [...map.values()];
}

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
  private readonly scenarios = inject(ScenariosClient);
  private readonly items = inject(ItemsClient);
  private readonly me = inject(MeClient);
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
  private readonly _scenarioReconciled = signal<ScenarioReconciled | null>(
    null,
  );
  private readonly _avatarReconciled = signal<AvatarResponse | null>(null);

  private readonly ready: Promise<void>;
  private flushConflicts = 0;
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
    scenarioComplete: this._scenarioReconciled.asReadonly(),
    /** Canonical avatar after queued equips / config edits synced. */
    avatar: this._avatarReconciled.asReadonly(),
  };
  /** Lessons with a queued completion — the curriculum shows a clock icon. */
  readonly pendingLessonIds = computed(
    () =>
      new Set(
        this.pending()
          .filter((e) => LESSON_COMPLETION_KINDS.includes(e.kind))
          .map((e) => eventLessonId(e))
          .filter((id): id is string => !!id),
      ),
  );
  /** "Estimated" XP / coins of queued completions (docs/16 §8). */
  readonly pendingEstimate = computed(() => estimatePending(this.pending()));
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
    opts: { title?: string; estimate?: { xp: number; coins: number } } = {},
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
      ...(opts.estimate ? { estimate: opts.estimate } : {}),
    };
    if (!existing) {
      await this.store.enqueue(ev);
      await this.refresh();
      if (!this.network.online()) this.trackEnqueued(ev.kind);
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
    opts: { title?: string; estimate?: { xp: number; coins: number } } = {},
  ): Promise<QuizSubmitOutcome> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    await this.ready;
    const clientTimestamp = Date.now();
    // One key for the live try and its queued fallback: if the live request
    // landed but its response was lost, the queued replay returns that same
    // attempt instead of recording a second one.
    const attemptKey = newClientEventId();

    if (this.network.online() && !this._authBlocked()) {
      try {
        const result = await this.quizzes.submit(lessonId, answers, {
          clientTimestamp: new Date(clientTimestamp).toISOString(),
          idempotencyKey: attemptKey,
        });
        this.telemetry.track('quiz_submit', {
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
      clientEventId: existing?.clientEventId ?? attemptKey,
      clientTimestamp,
      userId,
      lessonId,
      answers,
      attempts: 0,
      ...(localCheck ? { localCheck } : {}),
      ...(opts.title ? { lessonTitle: opts.title } : {}),
      ...(opts.estimate ? { estimate: opts.estimate } : {}),
    };
    await this.store.enqueue(ev);
    await this.refresh();
    this.trackEnqueued(ev.kind);
    this.telemetry.track('quiz_submit', {
      lessonId,
      offline: true,
      localAllCorrect: localCheck?.allCorrect ?? null,
    });
    this.scheduleRetry();
    return { status: 'queued', clientEventId: ev.clientEventId, localCheck };
  }

  /**
   * Record a finished scenario play-through. Online → the API (with an
   * Idempotency-Key, so a lost response replays safely); offline, or the
   * request never landed → queued `scenario_complete` with the local walk
   * result, replayed on sync where the server re-scores the path.
   */
  async completeScenario(
    lessonId: string,
    scenarioId: string,
    path: string[],
    opts: {
      title?: string;
      estimate?: { xp: number; coins: number };
      rubricScore?: QueuedScenarioComplete['rubricScore'];
    } = {},
  ): Promise<ScenarioCompleteOutcome> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    await this.ready;
    const clientTimestamp = Date.now();
    const key = newClientEventId();
    if (this.network.online() && !this._authBlocked()) {
      try {
        const result = await this.scenarios.complete(scenarioId, path, {
          idempotencyKey: key,
        });
        return { status: 'synced', result };
      } catch (err) {
        if (classifySyncFailure(err) !== 'retry') throw err;
      }
    }
    // Keep the best local play per lesson (a completed path beats a partial one).
    const existing = this._events().find(
      (e): e is QueuedScenarioComplete =>
        e.kind === 'scenario_complete' &&
        e.userId === userId &&
        e.lessonId === lessonId,
    );
    if (existing?.rubricScore?.completed && !opts.rubricScore?.completed) {
      return { status: 'queued', clientEventId: existing.clientEventId };
    }
    const ev: QueuedScenarioComplete = {
      kind: 'scenario_complete',
      clientEventId: existing?.clientEventId ?? key,
      clientTimestamp,
      userId,
      lessonId,
      scenarioId,
      chosenPath: path,
      attempts: 0,
      ...(opts.rubricScore ? { rubricScore: opts.rubricScore } : {}),
      ...(opts.title ? { lessonTitle: opts.title } : {}),
      ...(opts.estimate ? { estimate: opts.estimate } : {}),
    };
    await this.store.enqueue(ev);
    await this.refresh();
    this.trackEnqueued(ev.kind);
    this.scheduleRetry();
    return { status: 'queued', clientEventId: ev.clientEventId };
  }

  /**
   * Queue avatar equips made offline (re-equip from owned items only,
   * docs/16 §3), unequips (`itemId: null`) included. Changes coalesce
   * into one event per user (latest per slot, each stamped with its own
   * time); the server applies them per slot last-write-wins by that time,
   * an unequip leaving a tombstone so an older equip cannot win later.
   */
  async queueAvatarEquip(
    changes: { slot: ItemSlot; itemId: string | null }[],
  ): Promise<string> {
    const userId = this.requireUser();
    await this.ready;
    const prev = this.singleton<QueuedAvatarEquip>('avatar_equip', userId);
    const now = Date.now();
    const ev: QueuedAvatarEquip = {
      kind: 'avatar_equip',
      clientEventId: prev?.clientEventId ?? newClientEventId(),
      clientTimestamp: now,
      userId,
      attempts: 0,
      slotChanges: mergeSlotChanges(prev?.slotChanges ?? [], changes, now),
    };
    return this.enqueueAndKick(ev);
  }

  /** Queue an offline avatar config edit (merged with a pending one). */
  async queueAvatarConfig(config: Record<string, unknown>): Promise<string> {
    const userId = this.requireUser();
    await this.ready;
    const prev = this.singleton<QueuedAvatarConfig>(
      'avatar_config_update',
      userId,
    );
    const ev: QueuedAvatarConfig = {
      kind: 'avatar_config_update',
      clientEventId: prev?.clientEventId ?? newClientEventId(),
      clientTimestamp: Date.now(),
      userId,
      attempts: 0,
      config: { ...(prev?.config ?? {}), ...config },
    };
    return this.enqueueAndKick(ev);
  }

  /**
   * Change account settings (`PATCH /me`): sent now when online, queued
   * as `preference_update` otherwise (merged; the latest value wins).
   * Resolves `true` when the server already has it.
   */
  async updatePreferences(prefs: PreferencePatch): Promise<boolean> {
    const userId = this.requireUser();
    await this.ready;
    if (this.network.online() && !this._authBlocked()) {
      try {
        await this.me.update(prefs);
        return true;
      } catch (err) {
        if (classifySyncFailure(err) !== 'retry') throw err;
      }
    }
    const prev = this.singleton<QueuedPreferenceUpdate>(
      'preference_update',
      userId,
    );
    await this.enqueueAndKick({
      kind: 'preference_update',
      clientEventId: prev?.clientEventId ?? newClientEventId(),
      clientTimestamp: Date.now(),
      userId,
      attempts: 0,
      prefs: { ...(prev?.prefs ?? {}), ...prefs },
    });
    return false;
  }

  /**
   * A lesson was opened while offline: queue `lesson_progress_seen` so the
   * open is reported (with its real time) once the device syncs.
   */
  async markLessonSeen(lessonId: string, courseId?: string): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId || this.network.online()) return;
    await this.ready;
    const dup = this._events().some(
      (e) =>
        e.kind === 'lesson_progress_seen' &&
        e.userId === userId &&
        e.lessonId === lessonId,
    );
    if (dup) return;
    const ev: QueuedLessonSeen = {
      kind: 'lesson_progress_seen',
      clientEventId: newClientEventId(),
      clientTimestamp: Date.now(),
      userId,
      attempts: 0,
      lessonId,
      ...(courseId ? { courseId } : {}),
    };
    await this.enqueueAndKick(ev);
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

  private requireUser(): string {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('Not signed in');
    return userId;
  }

  /** The user's pending coalescing event of `kind`, if any. */
  private singleton<T extends QueuedEvent>(
    kind: T['kind'],
    userId: string,
  ): T | undefined {
    return this._events().find(
      (e): e is T => e.kind === kind && e.userId === userId,
    );
  }

  private async enqueueAndKick(ev: QueuedEvent): Promise<string> {
    await this.store.enqueue(ev);
    await this.refresh();
    this.trackEnqueued(ev.kind);
    if (this.network.online() && !this._authBlocked()) void this.flush();
    else this.scheduleRetry();
    return ev.clientEventId;
  }

  private trackEnqueued(kind: string): void {
    this.telemetry.track('offline_queue_enqueued', {
      kind,
      queueDepth: this.pendingCount(),
    });
  }

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
    this.telemetry.track('queue_depth_on_flush', {
      queueDepth: events.length,
      manual,
    });
    let synced = 0;
    let dropped = 0;
    let halted = false;
    this.flushConflicts = 0;
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
    // docs/10 §14 catalogue name; `halted` marks a flush that stopped early.
    this.telemetry.track('sync_flush', {
      sent: synced + dropped,
      succeeded: synced - this.flushConflicts,
      conflicts: this.flushConflicts,
      failed: dropped,
      remaining,
      halted,
      durationMs: Date.now() - started,
    });
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
    const opts: { clientTimestamp?: string } = ev.dropTimestamp
      ? {}
      : { clientTimestamp: new Date(ev.clientTimestamp).toISOString() };
    try {
      if (ev.kind !== 'lesson_complete' && ev.kind !== 'quiz_attempt') {
        await this.sendOther(ev, opts.clientTimestamp, foreground);
        await this.store.remove(ev.clientEventId);
        await this.refresh();
        return {
          next: 'continue',
          synced: true,
          outcome: { status: 'queued', clientEventId: ev.clientEventId },
        };
      }
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
      const result = await this.quizzes.submit(ev.lessonId, ev.answers, {
        ...opts,
        idempotencyKey: ev.clientEventId,
      });
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

  /** Replay a non-lesson queued event (scenario / avatar / prefs / seen). */
  private async sendOther(
    ev: Exclude<QueuedEvent, QueuedLessonComplete | QueuedQuizAttempt>,
    clientTimestamp: string | undefined,
    foreground: boolean,
  ): Promise<void> {
    switch (ev.kind) {
      case 'scenario_complete': {
        const result = await this.scenarios.complete(
          ev.scenarioId,
          ev.chosenPath,
          { idempotencyKey: ev.clientEventId, clientTimestamp },
        );
        this._scenarioReconciled.set({
          lessonId: ev.lessonId,
          result,
          clientEventId: ev.clientEventId,
        });
        if (!foreground && result.completed) {
          this.toast.show({
            message: 'studentPlatform.sync.scenarioSynced',
            params: { title: ev.lessonTitle ?? '' },
            kind: 'success',
          });
        }
        return;
      }
      case 'avatar_equip': {
        let last: AvatarResponse | null = null;
        let stale = false;
        for (const c of ev.slotChanges) {
          // Each slot replays with its own change time (unless the server
          // refused timestamps for this event — then none is sent).
          last = await this.items.equip(c.slot as ItemSlot, c.itemId, {
            clientTimestamp:
              clientTimestamp && c.at !== undefined
                ? new Date(c.at).toISOString()
                : clientTimestamp,
            idempotencyKey: `${ev.clientEventId}:${c.slot}`,
          });
          stale ||= !!last.stale;
        }
        if (last) this._avatarReconciled.set(last);
        if (stale) this.noteAvatarStale(foreground);
        return;
      }
      case 'avatar_config_update': {
        const res = await this.items.saveConfig(ev.config, {
          clientTimestamp,
          idempotencyKey: ev.clientEventId,
        });
        this._avatarReconciled.set(res);
        if (res.stale) this.noteAvatarStale(foreground);
        return;
      }
      case 'preference_update':
        await this.me.update(ev.prefs);
        return;
      case 'lesson_progress_seen':
        this.telemetry.trackAt(
          'lesson_progress_seen',
          { lessonId: ev.lessonId, courseId: ev.courseId ?? null },
          ev.clientTimestamp,
        );
        return;
    }
  }

  private noteAvatarStale(foreground: boolean): void {
    this.telemetry.track('sync_conflict', {
      kind: 'avatar',
      resolution: 'server_newer',
    });
    if (!foreground)
      this.toast.show({
        message: 'studentPlatform.sync.avatarNewer',
        kind: 'info',
      });
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
        this.flushConflicts += 1;
        this.telemetry.track('sync_conflict', {
          kind: ev.kind,
          resolution: 'server_kept',
        });
        if (ev.kind === 'lesson_complete' && !foreground) {
          // docs/16 §8: another device completed it first.
          this.toast.show({
            message: ev.lessonTitle
              ? 'studentPlatform.sync.completedElsewhereTitled'
              : 'studentPlatform.sync.completedElsewhere',
            params: { title: ev.lessonTitle ?? '' },
            kind: 'info',
          });
        }
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
    const lessonId = eventLessonId(ev) ?? '';
    if (kind === 'paywall') {
      this._paywall.set({ lessonId, at: Date.now() });
      if (!foreground) {
        this.toast.show({
          message: 'studentPlatform.sync.paywall',
          kind: 'warning',
        });
      }
      return {
        next: 'continue',
        synced: false,
        outcome: { status: 'paywall', lessonId, error: problem },
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
        lessonId,
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
          await checkQuizAnswer(
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
