#!/usr/bin/env node
// Dependency audit gate (docs/14 §16): `pnpm audit --prod`, high/critical
// fail the build unless the advisory is listed in audit-allowlist.json with
// a reason and an expiry date (≤ 90 days out). Expired entries fail too, so
// every accepted risk is re-reviewed.
//
//   node infra/ci/audit-check.mjs              # runs pnpm audit
//   node infra/ci/audit-check.mjs audit.json   # or reads a saved report
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const allow = JSON.parse(
  readFileSync(join(here, 'audit-allowlist.json'), 'utf8'),
).advisories;

let raw;
if (process.argv[2]) raw = readFileSync(process.argv[2], 'utf8');
else {
  try {
    raw = execFileSync('pnpm', ['audit', '--prod', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // pnpm audit exits non-zero when it finds anything; the JSON is on stdout.
    raw = err.stdout;
    if (!raw) throw err;
  }
}
const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);

const failures = [];
const accepted = [];
for (const adv of Object.values(report.advisories ?? {})) {
  if (adv.severity !== 'high' && adv.severity !== 'critical') continue;
  const id = adv.github_advisory_id ?? String(adv.id);
  const entry = allow[id];
  const line = `${adv.severity} ${adv.module_name} ${adv.vulnerable_versions} (${id}) — ${adv.title}; fixed in ${adv.patched_versions}`;
  if (!entry) failures.push(line);
  else if (entry.expires < today)
    failures.push(`${line}\n    allow-list entry expired ${entry.expires}`);
  else
    accepted.push(
      `${line}\n    accepted until ${entry.expires}: ${entry.reason}`,
    );
}
const stale = Object.keys(allow).filter(
  (id) =>
    !Object.values(report.advisories ?? {}).some(
      (a) => (a.github_advisory_id ?? String(a.id)) === id,
    ),
);

if (accepted.length)
  console.log(`Accepted (audit-allowlist.json):\n  ${accepted.join('\n  ')}`);
if (stale.length)
  console.log(
    `No longer reported — remove from audit-allowlist.json: ${stale.join(', ')}`,
  );
if (failures.length) {
  console.error(
    `pnpm audit: ${failures.length} high/critical advisory(ies) not accepted:\n  ${failures.join('\n  ')}\n` +
      'Upgrade the dependency, or accept it in infra/ci/audit-allowlist.json with a reason and an expiry.',
  );
  process.exit(1);
}
console.log('pnpm audit: no unaccepted high/critical advisories.');
