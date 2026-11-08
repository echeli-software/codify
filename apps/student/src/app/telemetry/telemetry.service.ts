import {
  DestroyRef,
  Injectable,
  InjectionToken,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  NavigationEnd,
  Router,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { I18nService } from '@codify/i18n';
import { TELEMETRY_CONSENT } from './consent.js';
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
/** Screen time below this is a redirect / bounce, not a view. */
const MIN_SCREEN_MS = 500;

/**
 * Names emitted before the docs/10 §14 catalogue settled → catalogue name.
 * Callers may still use the old name; the wire always carries the new one.
 */
export const LEGACY_EVENT_NAMES: Readonly<Record<string, string>> = {
  download_started: 'course_download_start',
  download_completed: 'course_download_complete',
  download_failed: 'course_download_fail',
  download_eviction: 'cache_evicted',
  push_opened: 'push_open',
  sync_flush_completed: 'sync_flush',
  sync_flush_failed: 'sync_flush',
};

/** Route pattern of a snapshot (`/lessons/:id`), never the concrete URL. */
export function routePattern(root: ActivatedRouteSnapshot | null): string {
  const parts: string[] = [];
  let node: ActivatedRouteSnapshot | null = root;
  while (node) {
    const path = node.routeConfig?.path;
    if (path) parts.push(path);
    node = node.firstChild;
  }
  return '/' + parts.join('/');
}

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
  private readonly i18n = inject(I18nService, { optional: true });
  private readonly consent = inject(TELEMETRY_CONSENT, { optional: true });

  readonly anonymousId = readOrCreateAnonymousId();
  private readonly platform = runtimePlatform();
  private queue: AnalyticsEventInput[] = [];
  private inFlight: Promise<void> | null = null;
  private restored: Promise<void>;
  private lastUserId: string | null | undefined = undefined;
  private screen: { route: string; since: number } | null = null;
  private offlineSince: number | null = null;

  constructor() {
    this.restored = this.restore();

    if (typeof window !== 'undefined') {
      const timer = setInterval(() => void this.flush(), TELEMETRY_FLUSH_MS);
      const onVisibility = () => {
        if (document.visibilityState !== 'hidden') {
          if (this.screen) this.screen.since = Date.now();
          return;
        }
        // Close the current screen's time before the tab may go away.
        if (this.screen) {
          const ms = Date.now() - this.screen.since;
          if (ms >= MIN_SCREEN_MS)
            this.track('screen_time', {
              route: this.screen.route,
              durationMs: ms,
            });
          this.screen.since = Date.now();
        }
        void this.flush();
      };
      document.addEventListener('visibilitychange', onVisibility);
      inject(DestroyRef).onDestroy(() => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      });
    }

    // Back online → drain what was buffered; time offline sessions
    // (docs/16 §11 `offline_session_minutes`).
    effect(() => {
      const online = this.network.online();
      untracked(() => {
        if (!online) {
          this.offlineSince ??= Date.now();
          return;
        }
        if (this.offlineSince !== null) {
          const ms = Date.now() - this.offlineSince;
          this.offlineSince = null;
          if (ms >= 60_000)
            this.track('offline_session_minutes', {
              minutes: Math.round(ms / 60_000),
            });
        }
        void this.flush();
      });
    });

    // Route views + screen time per route (docs/05 §9).
    const router = inject(Router, { optional: true });
    if (router) {
      const sub = router.events.subscribe((e) => {
        if (e instanceof NavigationEnd)
          this.onRoute(routePattern(router.routerState.snapshot.root));
      });
      inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    }

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
    this.trackAt(name, props, Date.now());
  }

  /**
   * Record an event that happened at `at` (epoch ms) — e.g. an offline
   * `lesson_progress_seen` replayed on sync. Common props (docs/10 §14):
   * `locale` and `online` are added here; platform / appVersion ride on
   * the batch.
   */
  trackAt(
    name: string,
    props: Record<string, unknown> | undefined,
    at: number,
  ): void {
    try {
      name = LEGACY_EVENT_NAMES[name] ?? name;
      if (!EVENT_NAME.test(name)) return;
      if (this.consent && !this.consent()) return;
      const event: AnalyticsEventInput = {
        name,
        occurredAt: new Date(at).toISOString(),
      };
      const clean = sanitizeProps({
        ...props,
        locale: this.i18n?.currentLocale?.() ?? undefined,
        online: this.network.online(),
      });
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

  /** A paywall call-to-action was tapped (docs/05 §9 funnel). */
  paywallCta(props: {
    source: string;
    planId?: string | null;
    lessonId?: string | null;
  }): void {
    this.track('paywall_cta_tap', props);
  }

  /** One onboarding step finished (docs/05 §9 `onboarding_step_complete`). */
  onboardingStep(step: string, props: Record<string, unknown> = {}): void {
    this.track('onboarding_step_complete', { step, ...props });
  }

  private onRoute(route: string): void {
    const now = Date.now();
    const prev = this.screen;
    if (prev && prev.route === route) return;
    if (prev && now - prev.since >= MIN_SCREEN_MS)
      this.track('screen_time', {
        route: prev.route,
        durationMs: now - prev.since,
      });
    this.screen = { route, since: now };
    this.track('page_view', { route });
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
