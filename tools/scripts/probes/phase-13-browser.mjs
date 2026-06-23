#!/usr/bin/env node
/**
 * Phase 13 browser probe — marketing site + verifiable certificate.
 *
 *   1. Public /welcome landing renders (hero + pricing) with no auth.
 *   2. Seed + issue a real certificate via the API.
 *   3. Public /verify/:serial renders the certificate (valid, recipient, SVG).
 *   4. A bogus serial shows "not found".
 *
 * Requires API (:3000) + student (:4201).
 */

import { execSync } from 'node:child_process';
import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));

async function api(method, path, body, auth = 'Bearer dev-token-admin') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: auth, 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}
function sql(q) { return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); }

console.log(`Phase 13 browser probe — tag ${tag}\n`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  // 1. Public marketing landing — no auth set.
  await page.goto(`${STU}/welcome`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="hero"]', { timeout: 12_000 }).then(() => true).catch(() => false), 'public /welcome renders (no auth)', '');
  must(!!(await page.$('[data-testid="pricing"]')) && !!(await page.$('[data-testid="cta-start"]')), 'landing shows pricing + start CTA', '');

  // 2. Issue a certificate via the API.
  const STUDENT_ID = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);
  const cat = await api('POST', '/categories', { slug: `p13br-${tag}`, name: 'C' });
  const course = await api('POST', '/courses', { slug: `p13br-c-${tag}`, title: `Verify Me ${tag}`, categoryIds: [cat.id] });
  const mod = await api('POST', `/courses/${course.id}/modules`, { title: 'M' });
  const l1 = await api('POST', `/modules/${mod.id}/lessons`, { title: 'L1', type: 'READING', isFree: true });
  await api('POST', `/courses/${course.id}/publish`, {});
  sql(`DELETE FROM "Certificate" WHERE "userId"='${STUDENT_ID}' AND "courseId"='${course.id}'`);
  sql(`DELETE FROM "Progress" WHERE "userId"='${STUDENT_ID}' AND "lessonId"='${l1.id}'`);
  await api('POST', `/lessons/${l1.id}/complete`, {}, 'Bearer dev-token-student');
  const cert = await api('POST', '/certificates/claim', { courseId: course.id }, 'Bearer dev-token-student');
  must(/^CDFY-/.test(cert?.serial ?? ''), 'seeded certificate', cert?.serial);

  // 3. Public verify page.
  await page.goto(`${STU}/verify/${cert.serial}`, { waitUntil: 'networkidle2' });
  const valid = await page.waitForSelector('[data-testid="verify-valid"]', { timeout: 12_000 }).then(() => true).catch(() => false);
  must(valid, 'public /verify/:serial confirms a valid certificate', '');
  const recipient = await page.$eval('[data-testid="verify-recipient"]', (el) => el.textContent?.trim()).catch(() => '');
  must(!!recipient && recipient === cert.recipientName, 'verify page shows the recipient name', JSON.stringify(recipient));
  must(!!(await page.$('[data-testid="verify-image"]')), 'verify page embeds the certificate image', '');

  // 4. Bogus serial.
  await page.goto(`${STU}/verify/CDFY-0000-0000`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="verify-invalid"]', { timeout: 12_000 }).then(() => true).catch(() => false), 'bogus serial shows "not found"', '');
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
