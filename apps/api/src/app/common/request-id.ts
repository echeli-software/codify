import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Request id for logs, problem+json bodies and Sentry. Honors an inbound
 * `X-Request-Id` (e.g. from Cloudflare / the reverse proxy) when it looks
 * safe, otherwise mints a UUID. Echoed back on the response.
 */
export function genRequestId(
  req: IncomingMessage,
  res?: ServerResponse,
): string {
  const existing = (req as IncomingMessage & { id?: unknown }).id;
  if (typeof existing === 'string' && existing) return existing;
  const inbound = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof inbound === 'string' && SAFE_ID.test(inbound)
      ? inbound
      : randomUUID();
  res?.setHeader('X-Request-Id', id);
  return id;
}

/** Read (or lazily assign) the request id of a request. */
export function requestIdOf(
  req: IncomingMessage,
  res?: ServerResponse,
): string {
  const r = req as IncomingMessage & { id?: unknown };
  if (typeof r.id === 'string' && r.id) return r.id;
  const id = genRequestId(req, res);
  r.id = id;
  return id;
}
