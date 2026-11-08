#!/usr/bin/env node
// Licence allow-list for production dependencies (docs/14 §16).
//
//   node infra/ci/licence-check.mjs            # runs `pnpm licenses list --prod --json`
//   node infra/ci/licence-check.mjs lic.json   # or reads a saved report
//
// Fails when a production dependency's licence is not on ALLOWED and the
// package isn't an approved exception below. Copyleft (GPL / AGPL / LGPL /
// SSPL / EUPL, …) is blocked unless approved here with a reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Permissive licences (SPDX ids). */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0', // data only (caniuse-lite)
  'Python-2.0',
  'Zlib',
]);

/** Packages approved despite a licence outside ALLOWED (name → reason). */
const APPROVED = {
  // Functional Source License (source-available, converts to Apache-2.0
  // after two years). Pulled in by @sentry/node's bundler plugin; we only
  // use it as a library, which FSL permits.
  sentry:
    'FSL-1.1-Apache-2.0 via @sentry/node — library use permitted (approved 2026-11)',
  // Eclipse Public License 2.0 (file-level copyleft). Pulled in by the
  // prisma CLI's Studio (@prisma/studio-core), a local dev tool that is not
  // part of the API bundle; used unmodified.
  elkjs:
    'EPL-2.0 via prisma → @prisma/studio-core — dev tool, unmodified (approved 2026-11)',
};

/** "(MPL-2.0 OR Apache-2.0)" → OK if any alternative is allowed; "A AND B" → all. */
function licenceOk(expr) {
  const e = expr.replace(/[()]/g, '').trim();
  if (/ OR /i.test(e)) return e.split(/ OR /i).some((p) => licenceOk(p));
  if (/ AND /i.test(e)) return e.split(/ AND /i).every((p) => licenceOk(p));
  return ALLOWED.has(e);
}

const raw = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
const byLicence = JSON.parse(raw);

const problems = [];
let total = 0;
for (const [licence, pkgs] of Object.entries(byLicence)) {
  for (const p of pkgs) {
    total++;
    if (licenceOk(licence)) continue;
    if (APPROVED[p.name]) continue;
    problems.push(`${p.name}@${(p.versions ?? []).join('/')}: ${licence}`);
  }
}
if (problems.length) {
  console.error(
    `Licence check: ${problems.length} production package(s) outside the allow-list (docs/14 §16):\n  ` +
      problems.join('\n  ') +
      '\nApprove deliberately in infra/ci/licence-check.mjs (APPROVED, with a reason) or replace the dependency.',
  );
  process.exit(1);
}
console.log(`Licence check: ${total} production packages OK.`);
