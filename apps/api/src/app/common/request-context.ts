import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { clientIp, type ClientIpRequest } from './client-ip.js';
import { requestIdOf } from './request-id.js';

/**
 * Per-request facts that services need without threading `req` through
 * every call (audit rows, logs). Established by RequestContextMiddleware
 * for every HTTP request; `undefined` in jobs, queue workers and tests.
 */
export interface RequestContext {
  requestId: string | null;
  /** Client IP from `clientIp()` (Cloudflare-aware). */
  ip: string | null;
  /** User agent, truncated to 512 chars. */
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const MAX_USER_AGENT_LENGTH = 512;

/** The current request's context, if any. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Run `fn` inside a request context (tests, workers that want one). */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function requestContextOf(
  req: IncomingMessage & ClientIpRequest,
  res?: ServerResponse,
): RequestContext {
  const ua = req.headers['user-agent'];
  const userAgent = (Array.isArray(ua) ? ua[0] : ua)?.trim() || null;
  return {
    requestId: requestIdOf(req, res),
    ip: clientIp(req),
    userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
  };
}

/**
 * Registered first in AppModule (after the body parsers, so the context
 * survives their stream callbacks): everything downstream — guards,
 * handlers, fire-and-forget `audit.record` calls — sees the context.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(
    req: IncomingMessage & ClientIpRequest,
    res: ServerResponse,
    next: () => void,
  ): void {
    storage.run(requestContextOf(req, res), next);
  }
}
