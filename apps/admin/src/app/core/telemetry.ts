import { DestroyRef, Injectable, inject } from '@angular/core';
import {
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, tap, type Observable } from 'rxjs';
import { AuthService } from '@codify/auth';
import { I18nService } from '@codify/i18n';
import { AnalyticsClient, type AnalyticsEventInput } from '@codify/api-client';

/** docs/04 §8 feature events, as snake_case ingest names. */
export type AdminFeatureEvent =
  | 'course_created'
  | 'course_published'
  | 'multiplier_created'
  | 'user_suspended'
  | 'coins_granted'
  | 'translation_completed';

export const ADMIN_PLATFORM = 'admin-web';
/** Flush when this many events are queued… */
export const FLUSH_SIZE = 20;
/** …or this long after the first queued event. */
export const FLUSH_DELAY_MS = 5_000;
/** Oldest events are dropped beyond this (e.g. while offline). */
export const MAX_QUEUE = 200;
/** Server batch limit (MAX_EVENTS_PER_BATCH). */
const MAX_BATCH = 50;

/**
 * Successful admin mutations → feature events. Matched on method + API
 * path (after `/api`); the first matching rule wins. Lesson content has
 * no publish step of its own — lessons go live with their course — so
 * docs/04's `lesson.published` is reported as `course_published`.
 */
export const FEATURE_RULES: readonly {
  method: string;
  path: RegExp;
  event: AdminFeatureEvent;
  props?: (req: HttpRequest<unknown>, match: RegExpMatchArray) => object;
}[] = [
  { method: 'POST', path: /^\/courses$/, event: 'course_created' },
  {
    method: 'POST',
    path: /^\/courses\/([^/]+)\/publish$/,
    event: 'course_published',
    props: (_r, m) => ({ courseId: decodeURIComponent(m[1]) }),
  },
  { method: 'POST', path: /^\/multipliers$/, event: 'multiplier_created' },
  {
    method: 'POST',
    path: /^\/admin\/users\/([^/]+)\/suspend$/,
    event: 'user_suspended',
  },
  {
    method: 'POST',
    path: /^\/admin\/users\/([^/]+)\/(?:coins|coin-grants|coins\/grant)$/,
    event: 'coins_granted',
    props: (req) => {
      const amount = (req.body as { amount?: unknown } | null)?.amount;
      return typeof amount === 'number' ? { amount } : {};
    },
  },
  {
    method: 'PUT',
    path: /^\/admin\/translations$/,
    event: 'translation_completed',
    props: (req) => {
      const items = (req.body as { items?: unknown[] } | null)?.items;
      return Array.isArray(items) ? { count: items.length } : {};
    },
  },
];

/** API path of a request URL: everything after the first `/api`. */
export function apiPath(url: string): string | null {
  const noQuery = url.split(/[?#]/)[0];
  const i = noQuery.indexOf('/api/');
  return i >= 0 ? noQuery.slice(i + 4) : null;
}

/** The feature event (if any) a successful request represents. */
export function featureEventFor(
  req: HttpRequest<unknown>,
): { name: AdminFeatureEvent; props: object } | null {
  const path = apiPath(req.url);
  if (!path) return null;
  for (const rule of FEATURE_RULES) {
    if (rule.method !== req.method) continue;
    const m = path.match(rule.path);
    if (m) return { name: rule.event, props: rule.props?.(req, m) ?? {} };
  }
  return null;
}

/**
 * Route pattern of the deepest active route (`users/:id`), so page views
 * aggregate per screen rather than per record.
 */
export function routePattern(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  let node: ActivatedRouteSnapshot | null = root;
  while (node) {
    const p = node.routeConfig?.path;
    if (p) parts.push(p);
    node = node.firstChild;
  }
  return '/' + parts.join('/');
}

/**
 * Admin telemetry (docs/04 §8): page views (route + role + locale) and
 * feature events, queued and sent in batches through the analytics ingest
 * (AnalyticsClient). Fire-and-forget: tracking never awaits the network,
 * and a failed send is dropped rather than retried in a loop.
 */
@Injectable({ providedIn: 'root' })
export class AdminTelemetry {
  private readonly analytics = inject(AnalyticsClient);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private queue: AnalyticsEventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private started = false;

  /** Start page-view tracking (idempotent). Call from the shell. */
  trackPageViews(router: Router, destroyRef: DestroyRef): void {
    if (this.started) return;
    this.started = true;
    const sub = router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() =>
        this.track('admin_page_view', {
          route: routePattern(router.routerState.snapshot.root),
        }),
      );
    const onHide = () => this.flush();
    if (typeof window !== 'undefined')
      window.addEventListener('pagehide', onHide);
    destroyRef.onDestroy(() => {
      sub.unsubscribe();
      if (typeof window !== 'undefined')
        window.removeEventListener('pagehide', onHide);
      this.started = false;
      this.flush();
    });
  }

  /** Queue one event; role + locale are added to every event. */
  track(name: string, props: object = {}): void {
    this.queue.push({
      name,
      props: {
        ...props,
        role: this.auth.role() ?? 'anonymous',
        locale: this.i18n.currentLocale(),
      },
      occurredAt: new Date().toISOString(),
    });
    if (this.queue.length > MAX_QUEUE)
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= FLUSH_SIZE) this.flush();
    else if (!this.timer)
      this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  /** Send what is queued now (one batch in flight at a time). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.sending || this.queue.length === 0) return;
    const events = this.queue.splice(0, MAX_BATCH);
    this.sending = true;
    this.analytics
      .send({ platform: ADMIN_PLATFORM, events })
      .catch(() => undefined)
      .finally(() => {
        this.sending = false;
        if (this.queue.length > 0 && !this.timer)
          this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
      });
  }
}

/**
 * Emits docs/04 §8 feature events for successful admin mutations, whatever
 * page made them. Register after the auth/api-client interceptors.
 */
export const adminTelemetryInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const event = req.method === 'GET' ? null : featureEventFor(req);
  if (!event) return next(req);
  const telemetry = inject(AdminTelemetry);
  return next(req).pipe(
    tap((res) => {
      if (res instanceof HttpResponse && res.ok)
        telemetry.track(event.name, event.props);
    }),
  );
};
