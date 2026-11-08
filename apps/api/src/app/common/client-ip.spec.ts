import express from 'express';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import {
  CLOUDFLARE_IP_RANGES,
  clientIp,
  isCloudflareAddress,
  resetClientIpOptions,
  stripV4Mapped,
} from './client-ip.js';
import { ipTracker } from './throttling/trackers.js';

const ON = { trustCloudflare: true, cloudflareRanges: CLOUDFLARE_IP_RANGES };
const OFF = { trustCloudflare: false, cloudflareRanges: CLOUDFLARE_IP_RANGES };
const CF_EDGE = '173.245.48.10';

describe('clientIp', () => {
  afterEach(() => {
    delete process.env['TRUST_CLOUDFLARE'];
    delete process.env['CLOUDFLARE_IP_RANGES'];
    resetClientIpOptions();
  });

  it('recognises Cloudflare edges (v4, v6, v4-mapped)', () => {
    expect(isCloudflareAddress(CF_EDGE, ON)).toBe(true);
    expect(isCloudflareAddress('2606:4700::1', ON)).toBe(true);
    expect(isCloudflareAddress(`::ffff:${CF_EDGE}`, ON)).toBe(true);
    expect(isCloudflareAddress('203.0.113.5', ON)).toBe(false);
    expect(isCloudflareAddress('not-an-ip', ON)).toBe(false);
  });

  it('uses CF-Connecting-IP only when the trusted hop is a Cloudflare edge', () => {
    const viaCf = {
      ip: CF_EDGE,
      headers: { 'cf-connecting-ip': '198.51.100.7' },
    };
    expect(clientIp(viaCf, ON)).toBe('198.51.100.7');
    // Direct-to-origin: the header is attacker-controlled → ignored.
    const direct = {
      ip: '203.0.113.5',
      headers: { 'cf-connecting-ip': '1.1.1.1' },
    };
    expect(clientIp(direct, ON)).toBe('203.0.113.5');
    // Disabled → Express' address.
    expect(clientIp(viaCf, OFF)).toBe(CF_EDGE);
    // Garbage header → Express' address.
    expect(
      clientIp({ ip: CF_EDGE, headers: { 'cf-connecting-ip': 'nope' } }, ON),
    ).toBe(CF_EDGE);
  });

  it('falls back to the socket address and strips v4-mapped prefixes', () => {
    expect(clientIp({ socket: { remoteAddress: '::ffff:10.0.0.4' } }, ON)).toBe(
      '10.0.0.4',
    );
    expect(clientIp({}, ON)).toBeNull();
    expect(stripV4Mapped('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(stripV4Mapped('2001:db8::1')).toBe('2001:db8::1');
  });

  it('reads TRUST_CLOUDFLARE / CLOUDFLARE_IP_RANGES from the environment', () => {
    const req = () => ({
      ip: '192.0.2.10',
      headers: { 'cf-connecting-ip': '198.51.100.9' },
    });
    expect(clientIp(req())).toBe('192.0.2.10');
    process.env['CLOUDFLARE_IP_RANGES'] = '192.0.2.0/24';
    resetClientIpOptions();
    expect(clientIp(req())).toBe('198.51.100.9');
    process.env['TRUST_CLOUDFLARE'] = 'false';
    resetClientIpOptions();
    expect(clientIp(req())).toBe('192.0.2.10');
  });

  it('feeds the rate-limit IP tracker', () => {
    expect(
      ipTracker({
        ip: CF_EDGE,
        headers: { 'cf-connecting-ip': '198.51.100.7' },
      }),
    ).toBe('ip:198.51.100.7');
  });

  it('resolves the real client through Express trust proxy + Cloudflare', async () => {
    // Coolify proxy (loopback here) → API; XFF carries the Cloudflare edge.
    const app = express();
    app.set('trust proxy', 'loopback, linklocal, uniquelocal');
    app.get('/', (req, res) => {
      res.json({ ip: req.ip, client: clientIp(req) });
    });
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const get = (headers: Record<string, string>) =>
      new Promise<{ ip: string; client: string }>((resolve, reject) => {
        const r = httpRequest({ port, path: '/', headers }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(JSON.parse(body)));
        });
        r.on('error', reject);
        r.end();
      });
    try {
      expect(
        await get({
          'x-forwarded-for': `6.6.6.6, ${CF_EDGE}`,
          'cf-connecting-ip': '198.51.100.7',
        }),
      ).toEqual({ ip: CF_EDGE, client: '198.51.100.7' });
      // Not via Cloudflare: XFF's last untrusted hop, header ignored.
      expect(
        await get({
          'x-forwarded-for': '203.0.113.9',
          'cf-connecting-ip': '1.1.1.1',
        }),
      ).toEqual({ ip: '203.0.113.9', client: '203.0.113.9' });
    } finally {
      server.close();
    }
  });
});
