#!/usr/bin/env node
/**
 * Phase 13a probe — certificates + referrals.
 *
 *   1. Seed a 2-lesson capstone course, published.
 *   2. Claim before completion → 400.
 *   3. STUDENT completes both lessons → claim issues a certificate (capstone),
 *      with the course title + recipient name snapshotted.
 *   4. Claim again → idempotent (same serial).
 *   5. Public verify by serial → valid; a bogus serial → invalid.
 *   6. The SVG image renders with the recipient + serial.
 *   7. GET /me/referral → a code + share URL.
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const STUDENT = 'Bearer dev-token-student';

const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));

async function api(method, path, body, auth = ADMIN) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: auth, 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, raw: text };
}
async function raw(path) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, ct: res.headers.get('content-type'), text: await res.text() };
}
function sql(q) { return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); }

console.log(`Phase 13a probe — tag ${tag}\n`);

const STUDENT_ID = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);

// 1. Seed a 2-lesson capstone course.
const cat = (await api('POST', '/categories', { slug: `cert-${tag}`, name: 'Cert' })).body;
const course = (await api('POST', '/courses', { slug: `cert-c-${tag}`, title: `Capstone ${tag}`, categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const l1 = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'L1', type: 'READING', isFree: true, baseXp: 5, baseCoins: 2 })).body;
const l2 = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'L2', type: 'READING', isFree: true, baseXp: 5, baseCoins: 2 })).body;
await api('POST', `/courses/${course.id}/publish`, {});
sql(`UPDATE "Course" SET "isCapstone"=true WHERE id='${course.id}'`);
sql(`DELETE FROM "Certificate" WHERE "userId"='${STUDENT_ID}' AND "courseId"='${course.id}'`);
sql(`DELETE FROM "Progress" WHERE "userId"='${STUDENT_ID}' AND "lessonId" IN ('${l1.id}','${l2.id}')`);
ok('seeded 2-lesson capstone course');

// 2. Claim before completion → 400.
const early = await api('POST', '/certificates/claim', { courseId: course.id }, STUDENT);
must(early.status === 400, 'claim before completion → 400', `${early.status}`);

// 3. Complete both lessons → claim issues a certificate.
await api('POST', `/lessons/${l1.id}/complete`, {}, STUDENT);
await api('POST', `/lessons/${l2.id}/complete`, {}, STUDENT);
const claim = await api('POST', '/certificates/claim', { courseId: course.id }, STUDENT);
must(claim.status === 201 && /^CDFY-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/.test(claim.body?.serial ?? ''), 'certificate issued on completion', JSON.stringify(claim.body?.serial));
must(claim.body?.isCapstone === true && claim.body?.courseTitle?.includes(tag) && claim.body?.recipientName, 'certificate snapshots capstone + title + recipient', JSON.stringify({ cap: claim.body?.isCapstone, t: claim.body?.courseTitle }));
const serial = claim.body.serial;

// 4. Idempotent claim.
const again = await api('POST', '/certificates/claim', { courseId: course.id }, STUDENT);
must(again.body?.serial === serial, 're-claim returns the same serial (idempotent)', `${again.body?.serial} vs ${serial}`);
must(sql(`SELECT count(*) FROM "Certificate" WHERE "userId"='${STUDENT_ID}' AND "courseId"='${course.id}'`) === '1', 'exactly one certificate row', '');

// 5. Public verify.
const verify = await api('GET', `/certificates/${serial}`, null, 'Bearer none');
must(verify.body?.valid === true && verify.body?.serial === serial, 'public verify by serial → valid', JSON.stringify(verify.body?.valid));
const bogus = await api('GET', `/certificates/CDFY-0000-0000`, null, 'Bearer none');
must(bogus.body?.valid === false, 'bogus serial → invalid', JSON.stringify(bogus.body));

// 6. SVG image.
const svg = await raw(`/certificates/${serial}/image.svg`);
must(svg.status === 200 && svg.ct?.includes('image/svg+xml'), 'SVG endpoint serves image/svg+xml', `${svg.status} ${svg.ct}`);
must(svg.text.includes(serial) && svg.text.includes(claim.body.recipientName) && svg.text.includes('<svg'), 'SVG contains the serial + recipient', '');

// 7. Referral.
const ref = await api('GET', '/me/referral', null, STUDENT);
must(!!ref.body?.code && ref.body?.shareUrl?.includes(ref.body?.code), 'referral code + share URL returned', JSON.stringify(ref.body));
const ref2 = await api('GET', '/me/referral', null, STUDENT);
must(ref2.body?.code === ref.body?.code, 'referral code is stable across calls', '');

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
