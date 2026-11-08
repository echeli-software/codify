import { normalizeIp } from '@nestjs/throttler';
import { clientIp, type ClientIpRequest } from '../client-ip.js';

interface TrackableRequest extends ClientIpRequest {
  user?: { userId?: string };
}

/** Client IP (`clientIp()`: Cloudflare-aware), IPv6 bucketed by /64. */
export function ipTracker(req: TrackableRequest): string {
  const ip = clientIp(req) ?? 'unknown';
  return `ip:${normalizeIp(ip)}`;
}

/** Authenticated user id, falling back to the client IP. */
export function userOrIpTracker(req: TrackableRequest): string {
  const userId = req.user?.userId;
  return userId ? `user:${userId}` : ipTracker(req);
}
