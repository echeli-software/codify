#!/usr/bin/env node
/**
 * Single source of truth for the admin/student web security + caching
 * headers (docs/14-security.md §5 and §15, docs/13-deployment.md §3/§6/§7).
 * Renders them for either host:
 *
 *   --format=pages   Cloudflare Pages `_headers` file (default host)
 *   --format=nginx   nginx `add_header` snippet for the static Docker images
 *
 *   node infra/web/security-headers.mjs --app=student --format=pages \
 *     --api-url=https://api.codify.app/api --out=dist/apps/student/browser/_headers
 *
 * Options (flags or env):
 *   --app          admin | student                                  (required)
 *   --api-url      API base URL; its origin goes into connect-src   (API_URL)
 *   --cdn-origin   asset CDN origin for img-src/media-src           (CDN_ORIGIN, default https://cdn.codify.app)
 *   --clerk-origin extra Clerk Frontend API origin (prod custom domain, e.g. https://clerk.codify.app) (CLERK_ORIGIN)
 *   --out          output file (stdout when omitted)
 *
 * Deliberate deviations from the literal CSP in docs/14 §5 (kept in sync there):
 *   - `https://o*.ingest.sentry.io` is not a valid CSP host pattern (wildcards
 *     are only allowed as the left-most label) → `https://*.ingest.sentry.io`
 *     and `https://*.ingest.us.sentry.io`.
 *   - R2 presigned uploads go to `https://<account>.r2.cloudflarestorage.com`,
 *     which `https://*.cloudflare.com` does not cover → added explicitly.
 *   - `worker-src 'self' blob:` for the Angular service worker and Monaco's
 *     web workers; `frame-src` adds `'self' blob:` for the sandboxed exercise
 *     preview iframe; `frame-ancestors 'none'` replaces X-Frame-Options.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a, ''];
  }),
);

const app = args.app;
const format = args.format ?? 'pages';
const apiUrl =
  args['api-url'] || process.env.API_URL || 'https://api.codify.app/api';
const cdnOrigin =
  args['cdn-origin'] || process.env.CDN_ORIGIN || 'https://cdn.codify.app';
const clerkOrigin = args['clerk-origin'] || process.env.CLERK_ORIGIN || '';

if (!['admin', 'student'].includes(app)) {
  console.error('--app=admin|student is required');
  process.exit(2);
}
if (!['pages', 'nginx'].includes(format)) {
  console.error('--format=pages|nginx');
  process.exit(2);
}

const apiOrigin = new URL(apiUrl).origin;
const clerk = ['https://*.clerk.accounts.dev', clerkOrigin].filter(Boolean);

const csp = [
  ['default-src', "'self'"],
  ['script-src', "'self'", ...clerk, 'https://js.stripe.com'],
  [
    'connect-src',
    "'self'",
    apiOrigin,
    ...clerk,
    'https://api.stripe.com',
    'https://*.cloudflare.com',
    'https://*.r2.cloudflarestorage.com',
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
  ],
  ['img-src', "'self'", cdnOrigin, 'data:', 'blob:', 'https://img.clerk.com'],
  ['media-src', "'self'", cdnOrigin],
  ['font-src', "'self'", 'data:'],
  ['style-src', "'self'", "'unsafe-inline'"],
  ['frame-src', "'self'", 'blob:', 'https://js.stripe.com', ...clerk],
  ['worker-src', "'self'", 'blob:'],
  ['manifest-src', "'self'"],
  ['base-uri', "'self'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
  ['object-src', "'none'"],
  ['upgrade-insecure-requests'],
]
  .map((d) => d.join(' '))
  .join('; ');

/** Headers sent on every response. */
const security = {
  'Content-Security-Policy': csp,
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), usb=(), magnetometer=(), gyroscope=(), payment=(self "https://js.stripe.com")',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Student only (docs/14 §5): cross-origin isolation for performance APIs.
  // `credentialless` (not `require-corp`) so CDN images without CORP headers
  // still load.
  ...(app === 'student'
    ? { 'Cross-Origin-Embedder-Policy': 'credentialless' }
    : {}),
};

/** Cache classes (docs/13 §3 + §7). */
const cache = {
  immutable: 'public, max-age=31536000, immutable',
  shell: 'public, max-age=60, stale-while-revalidate=600',
  revalidate: 'no-cache',
  short: 'public, max-age=3600',
};

// Angular (outputHashing: all) emits content-hashed main-/chunk-/polyfills-/
// styles-/worker- files at the root and hashed files under /media.
const hashedPrefixes = [
  '/main-',
  '/chunk-',
  '/polyfills-',
  '/styles-',
  '/worker-',
];

function renderPages() {
  const block = (path, headers) =>
    `${path}\n${Object.entries(headers)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n')}\n`;
  // Pages joins the values of a header set by several matching rules with a
  // comma, so the specific rules first detach (`! Cache-Control`) the
  // catch-all value before setting their own.
  const cacheBlock = (path, value) =>
    `${path}\n  ! Cache-Control\n  Cache-Control: ${value}\n`;
  const out = [
    '# Generated by infra/web/security-headers.mjs — do not edit in the build output.',
    block('/*', { ...security, 'Cache-Control': cache.shell }),
    ...hashedPrefixes.map((p) => cacheBlock(`${p}*`, cache.immutable)),
    cacheBlock('/media/*', cache.immutable),
    cacheBlock('/ngsw-worker.js', cache.revalidate),
    cacheBlock('/ngsw.json', cache.revalidate),
    cacheBlock('/safety-worker.js', cache.revalidate),
    cacheBlock('/assets/*', cache.short),
  ];
  return out.join('\n');
}

function renderNginx() {
  // Included inside every `location` of infra/web/nginx/default.conf (nginx
  // drops server-level add_header in any location that sets its own).
  const esc = (v) => v.replace(/"/g, '\\"');
  return [
    '# Generated by infra/web/security-headers.mjs — security headers for every response.',
    ...Object.entries(security).map(
      ([k, v]) => `add_header ${k} "${esc(v)}" always;`,
    ),
    '',
  ].join('\n');
}

const body = format === 'pages' ? renderPages() : renderNginx();
if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, body);
  console.error(`wrote ${args.out} (${app}, ${format}, api ${apiOrigin})`);
} else {
  process.stdout.write(body);
}
