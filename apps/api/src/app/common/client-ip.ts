import { BlockList, isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Cloudflare edge ranges (https://www.cloudflare.com/ips/, reviewed
 * 2026-11). Override with CLOUDFLARE_IP_RANGES (comma list of CIDRs) if
 * Cloudflare publishes new ranges before this list is updated.
 */
export const CLOUDFLARE_IP_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

export interface ClientIpOptions {
  /** Honour `CF-Connecting-IP` from Cloudflare edge addresses. */
  trustCloudflare: boolean;
  /** CIDRs treated as Cloudflare edges. */
  cloudflareRanges: string[];
}

export interface ClientIpRequest {
  /** Express' address after applying `trust proxy`. */
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: IncomingHttpHeaders;
  /** Memoised result (set by `clientIp`). */
  clientIp?: string | null;
}

function buildBlockList(ranges: string[]): BlockList {
  const list = new BlockList();
  for (const cidr of ranges) {
    const [net, bits] = cidr.split('/');
    const family = isIP(net ?? '');
    if (!net || !family || !bits) continue;
    list.addSubnet(net, Number(bits), family === 6 ? 'ipv6' : 'ipv4');
  }
  return list;
}

/** `::ffff:1.2.3.4` → `1.2.3.4`, so v4 ranges match dual-stack sockets. */
export function stripV4Mapped(ip: string): string {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

let defaults: { opts: ClientIpOptions; list: BlockList } | null = null;

function envOptions(): ClientIpOptions {
  const flag = (process.env['TRUST_CLOUDFLARE'] ?? '').trim().toLowerCase();
  const custom = (process.env['CLOUDFLARE_IP_RANGES'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    trustCloudflare: !(flag === 'false' || flag === '0' || flag === 'no'),
    cloudflareRanges: custom.length ? custom : CLOUDFLARE_IP_RANGES,
  };
}

function resolved(opts?: ClientIpOptions): {
  opts: ClientIpOptions;
  list: BlockList;
} {
  if (opts) return { opts, list: buildBlockList(opts.cloudflareRanges) };
  if (!defaults) {
    const o = envOptions();
    defaults = { opts: o, list: buildBlockList(o.cloudflareRanges) };
  }
  return defaults;
}

/** Test helper: re-read TRUST_CLOUDFLARE / CLOUDFLARE_IP_RANGES. */
export function resetClientIpOptions(): void {
  defaults = null;
}

/** True when `ip` is inside the configured Cloudflare ranges. */
export function isCloudflareAddress(
  ip: string,
  opts?: ClientIpOptions,
): boolean {
  const { list } = resolved(opts);
  const addr = stripV4Mapped(ip);
  const family = isIP(addr);
  if (!family) return false;
  return list.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

function header(req: ClientIpRequest, name: string): string | undefined {
  const v = req.headers?.[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

/**
 * The one client-IP function (docs/14 §7, §11) used by the rate-limit
 * trackers, audit rows and the request context.
 *
 * Production chain: client → Cloudflare → Coolify proxy (Traefik) → API.
 * Express resolves `req.ip` through `TRUST_PROXY` (default: private
 * networks, i.e. the Coolify proxy on the Docker network), which yields
 * the Cloudflare edge that connected to the proxy. Only when that address
 * is a Cloudflare edge is `CF-Connecting-IP` believed — a request that
 * reaches the origin directly cannot spoof its IP with the header.
 */
export function clientIp(
  req: ClientIpRequest,
  opts?: ClientIpOptions,
): string | null {
  if (!opts && req.clientIp !== undefined) return req.clientIp;
  const raw = req.ip ?? req.socket?.remoteAddress;
  let ip: string | null = raw ? stripV4Mapped(raw) : null;
  if (ip && viaCloudflare(req, opts)) {
    const cf = header(req, 'cf-connecting-ip');
    if (cf && isIP(cf)) ip = stripV4Mapped(cf);
  }
  if (!opts) req.clientIp = ip;
  return ip;
}

/**
 * True when the request reached us from a Cloudflare edge (and
 * TRUST_CLOUDFLARE is on), i.e. when Cloudflare's own request headers
 * (`CF-Connecting-IP`, `CF-IPCountry`) can be believed.
 */
export function viaCloudflare(
  req: ClientIpRequest,
  opts?: ClientIpOptions,
): boolean {
  const { opts: o } = resolved(opts);
  const raw = req.ip ?? req.socket?.remoteAddress;
  return !!raw && o.trustCloudflare && isCloudflareAddress(raw, opts);
}
