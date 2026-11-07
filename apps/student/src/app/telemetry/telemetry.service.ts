import {
  DestroyRef,
  Injectable,
  InjectionToken,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  AnalyticsClient,
  ProblemDetailsError,
  type AnalyticsEventInput,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { APP_VERSION } from '../api-base-url.js';
import { idbAvailable, idbStores, tx } from '../offline/db.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { runtimePlatform } from '../platform/runtime.js';

/** Server limit (AnalyticsBatchDto) — never send more per request. */
export const TELEMETRY_MAX_BATCH = 50;
/** Periodic flush interval. */
export const TELEMETRY_FLUSH_MS = 10_000;
/** Oldest events are dropped beyond this many buffered (offline for days). */
export const TELEMETRY_MAX_BUFFER = 1000;
/** Mirrors the API's snake_case event-name rule. */
const EVENT_NAME = /^[a-z][a-z0-9_]{1,63}$/;
/** Mirrors the API's per-event props cap. */
const MAX_PROPS_BYTES = 4096;
const ANON_KEY = 'codify.telemetry.anonymousId';

/**
 * Where events wait while the device is offline (or a send failed). The
 * default persists to IndexedDB so a closed tab doesn't lose them; tests
 * swap in an in-memory buffer.
 */
export interface TelemetryBuffer {
  load(): Promise<AnalyticsEventInput[]>;
  save(events: AnalyticsEventInput[]): Promise<void>;
}

const idbBuffer: TelemetryBuffer = {
  async load() {
    if (!idbAvailable()) return [];
    const v = await tx<AnalyticsEventInput[] | undefined>(
      idbStores.STORE_TELEMETRY,
      'readonly',
      (s) => s.get('buffer') as IDBRequest<AnalyticsEventInput[] | undefined>,
    );
    return Array.isArray(v) ? v : [];
  },
  async save(events) {
    if (!idbAvailable()) return;
    await tx(idbStores.STORE_TELEMETRY, 'readwrite', (s) =>
      s.put(events, 'buffer'),
    );
  },
};

export const TELEMETRY_BUFFER = new InjectionToken<TelemetryBuffer>(
  'TELEMETRY_BUFFER',
  { providedIn: 'root', factory: () => idbBuffer },
);

/**
 * First-party analytics wrapper (docs/10 §14, docs/16 §11). Pages call
 * `track('lesson_completed', { lessonId })`; the service batches events to
 * `AnalyticsClient.send` (≤ 50 per request) every 10 s, when the page is
 * hidden, and around sign-in/out. Offline, events are buffered in IndexedDB
 * and sent once connectivity returns. A per-install `anonymousId` is kept
 * in localStorage so pre-login events can be stitched server-side.
 *
 * `track()` never throws and never blocks the caller.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly analytics = inject(AnalyticsClient);
  private readonly network = inject(NetworkStatusService);
  private readonly auth = inject(AuthService);
  private readonly store = inject(TELEMETRY_BUFFER);

  readonly anonymousId = readOrCreateAnonymousId();
  private readonly platform = runtimePlatform();
  private queue: AnalyticsEventInput[] = [];
  private inFlight: Promise<void> | null = null;
  private restored: Promise<void>;
  private lastUserId: string | null | undefined = undefined;

  constructor() {
    this.restored = this.restore();

    if (typeof window !== 'undefined') {
      const timer = setInterval(() => void this.flush(), TELEMETRY_FLUSH_MS);
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') void this.flush();
      };
      document.addEventListener('visibilitychange', onVisibility);
      inject(DestroyRef).onDestroy(() => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      });
    }

    // Back online → drain what was buffered.
    effect(() => {
      if (this.network.online()) untracked(() => void this.flush());
    });

    // Sign-in / sign-out / account switch → flush so events are attributed
    // to the session they happened in as closely as possible.
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => {
        if (this.lastUserId !== undefined && this.lastUserId !== id) {
          void this.flush();
        }
        this.lastUserId = id;
      });
    });
  }

  /** Record one event. Invalid names are dropped silently. Never throws. */
  track(name: string, props?: Record<string, unknown>): void {
    try {
      if (!EVENT_NAME.test(name)) return;
      const event: AnalyticsEventInput = {
        name,
        occurredAt: new Date().toISOString(),
      };
      const clean = sanitizeProps(props);
      if (clean) event.props = clean;
      this.queue.push(event);
      if (this.queue.length > TELEMETRY_MAX_BUFFER) {
        this.queue.splice(0, this.queue.length - TELEMETRY_MAX_BUFFER);
      }
      if (this.queue.length >= TELEMETRY_MAX_BATCH) void this.flush();
    } catch {
      /* telemetry must never break the app */
    }
  }

  /** Events waiting to be sent (tests / debugging). */
  pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Send everything buffered, in batches of ≤ 50. Concurrent calls share
   * one in-flight flush. Offline or on a retryable failure the remainder is
   * persisted for later. Never rejects.
   */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doFlush()
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async doFlush(): Promise<void> {
    await this.restored;
    while (this.queue.length > 0) {
      if (!this.network.online()) break;
      const batch = this.queue.slice(0, TELEMETRY_MAX_BATCH);
      try {
        await this.analytics.send({
          anonymousId: this.anonymousId,
          platform: this.platform,
          appVersion: APP_VERSION.slice(0, 32),
          events: batch,
        });
        this.queue.splice(0, batch.length);
      } catch (err) {
        if (
          err instanceof ProblemDetailsError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 401 &&
          err.status !== 408 &&
          err.status !== 429
        ) {
          // The server rejected the batch's shape — retrying can't help.
          this.queue.splice(0, batch.length);
          continue;
        }
        break; // network / 5xx / throttled: keep for the next flush
      }
    }
    await this.persist();
  }

  private async restore(): Promise<void> {
    try {
      const saved = await this.store.load();
      if (saved.length > 0) {
        this.queue = [...saved, ...this.queue].slice(-TELEMETRY_MAX_BUFFER);
      }
    } catch {
      /* storage unavailable: memory-only telemetry */
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.save([...this.queue]);
    } catch {
      /* storage unavailable: memory-only telemetry */
    }
  }
}

function sanitizeProps(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || typeof v === 'function') continue;
    out[k] = v instanceof Error ? v.message : v;
  }
  if (Object.keys(out).length === 0) return undefined;
  try {
    if (JSON.stringify(out).length > MAX_PROPS_BYTES) {
      return { truncated: true };
    }
  } catch {
    return { unserializable: true };
  }
  return out;
}

function readOrCreateAnonymousId(): string {
  try {
    const existing = localStorage.getItem(ANON_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = randomId();
    localStorage.setItem(ANON_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
