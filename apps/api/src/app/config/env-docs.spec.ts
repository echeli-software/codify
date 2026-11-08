import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * FIX-2 guard: the deploy docs (infra/coolify/README.md, docs/13 §16) and
 * `.env.example` must only name variables the API actually reads, and must
 * list every variable production refuses to boot without. The code is the
 * authority: env.schema.ts keys + every UPPER_SNAKE string literal in
 * apps/api/src (how integrations read `env['X']`).
 */

const ROOT = join(__dirname, '../../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Consumed by docker-compose / the host, not the API process. */
const COMPOSE_ONLY = new Set(['REDIS_PASSWORD', 'CODIFY_API_IMAGE']);

/**
 * Production-required outside env.schema.ts's superRefine (each factory
 * throws at boot). Every entry is also checked to exist in the code.
 */
const REQUIRED_ELSEWHERE = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'REVENUECAT_WEBHOOK_AUTH',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
  'JUDGE0_URL',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'EMAIL_UNSUBSCRIBE_SECRET',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const apiSources = sourceFiles(join(ROOT, 'apps/api/src')).map((p) =>
  readFileSync(p, 'utf8'),
);
const schema = read('apps/api/src/app/config/env.schema.ts');

/** Every env name the API can read. */
const known = new Set<string>();
for (const src of apiSources)
  for (const m of src.matchAll(/['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"`]/g))
    known.add(m[1] as string);
for (const m of schema.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm))
  known.add(m[1] as string);

const schemaRequired = [...schema.matchAll(/need\(\s*'([A-Z][A-Z0-9_]+)'/g)]
  .map((m) => m[1] as string)
  // THROTTLE_ENABLED / ALLOW_DEV_AUTH are "must not be disabled/enabled".
  .filter((k) => k !== 'THROTTLE_ENABLED' && k !== 'ALLOW_DEV_AUTH');
const REQUIRED = [
  'NODE_ENV',
  'DATABASE_URL',
  ...schemaRequired,
  ...REQUIRED_ELSEWHERE,
];

/** Backticked UPPER_SNAKE names in a markdown section. */
function namesIn(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map(
      (m) => m[1] as string,
    ),
  );
}
function section(md: string, start: string, end: string): string {
  const i = md.indexOf(start);
  if (i < 0) throw new Error(`section "${start}" not found`);
  const j = md.indexOf(end, i + start.length);
  return md.slice(i, j < 0 ? undefined : j);
}

const coolify = namesIn(
  section(
    read('infra/coolify/README.md'),
    '## Runtime environment variables',
    '\n## ',
  ),
);
const docs13 = namesIn(
  section(read('docs/13-deployment.md'), '### Runtime (Coolify', '\n### '),
);
const envExample = new Set(
  [...read('.env.example').matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map(
    (m) => m[1] as string,
  ),
);

/** Mentioned in prose but not variables of the API (cross-references). */
const PROSE = new Set(['JUDGE0_AUTHN_TOKEN']);

describe('deploy docs ↔ env the API reads (FIX-2)', () => {
  it('the production-required list itself matches the code', () => {
    for (const k of REQUIRED) expect(known).toContain(k);
    expect(schemaRequired).toEqual(
      expect.arrayContaining(['CLERK_SECRET_KEY', 'CORS_ORIGINS', 'REDIS_URL']),
    );
  });

  it.each([
    ['infra/coolify/README.md', coolify],
    ['docs/13 §16 Runtime', docs13],
    ['.env.example', envExample],
  ])('%s names only variables the API reads', (_name, names) => {
    const unknown = [...names].filter(
      (n) => !known.has(n) && !COMPOSE_ONLY.has(n) && !PROSE.has(n),
    );
    expect(unknown).toEqual([]);
  });

  it.each([
    ['infra/coolify/README.md', coolify],
    ['docs/13 §16 Runtime', docs13],
  ])('%s lists every production-required variable', (_name, names) => {
    const missing = REQUIRED.filter(
      (k) =>
        !names.has(k) && !(k === 'REDIS_URL' && names.has('REDIS_PASSWORD')),
    );
    expect(missing).toEqual([]);
  });

  it('.env.example lists every production-required variable', () => {
    expect(REQUIRED.filter((k) => !envExample.has(k))).toEqual([]);
  });
});
