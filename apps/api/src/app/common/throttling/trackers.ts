import { normalizeIp } from '@nestjs/throttler';

interface TrackableRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  user?: { userId?: string };
}

/** Client IP (Express resolves it through `trust proxy`), IPv6 bucketed by /64. */
export function ipTracker(req: TrackableRequest): string {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return `ip:${normalizeIp(ip)}`;
}

/** Authenticated user id, falling back to the client IP. */
export function userOrIpTracker(req: TrackableRequest): string {
  const userId = req.user?.userId;
  return userId ? `user:${userId}` : ipTracker(req);
}
