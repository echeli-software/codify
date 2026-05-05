#!/usr/bin/env node
/**
 * Phase 5b end-to-end probe — admin Categories CRUD.
 *
 * Drives the actual /categories admin page in headless Chrome and
 * asserts the round-trips: list loads, create POSTs, edit PATCHes,
 * delete DELETEs, role guard 403s a STUDENT.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'shell' });
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error('  FAIL:', msg);
};
const ok = (msg) => console.log('  OK:', msg);

function captureCategoryCalls(page) {
  const calls = [];
  page.on('request', (req) => {
    if (!req.url().includes('/api/categories')) return;
    calls.push({
      request: req,
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      reqBody: req.postData() ?? undefined,
      status: 0,
    });
  });
  page.on('response', (res) => {
    if (!res.url().includes('/api/categories')) return;
    const entry = calls.find((c) => c.request === res.request());
    if (entry) entry.status = res.status();
  });
  return calls;
}

async function seedAdmin(page) {
  await page.goto('http://localhost:4202/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'codify.auth.user',
      JSON.stringify({
        id: 'dev-admin',
        email: 'admin@codify.local',
        displayName: 'Admin',
        role: 'ADMIN',
        avatarUrl: null,
        locale: 'pt-BR',
      }),
    );
    localStorage.setItem(
      'codify.auth.token',
      JSON.stringify({ token: 'dev-token-admin', expiresAt: null }),
    );
  });
}

async function setInputByLabel(page, labelText, value) {
  await page.evaluate(
    ({ labelText, value }) => {
      const labels = Array.from(document.querySelectorAll('cdf-form-field label'));
      const label = labels.find((l) => l.textContent?.trim().startsWith(labelText));
      if (!label) throw new Error(`label not found: ${labelText}`);
      const field = label.closest('cdf-form-field');
      const input = field?.querySelector('input');
      if (!input) throw new Error(`input not found under: ${labelText}`);
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      if (nativeSetter) nativeSetter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { labelText, value },
  );
}

async function clickButtonByText(page, text) {
  const handle = await page.evaluateHandle((needle) => {
    const buttons = Array.from(document.querySelectorAll('cdf-button button'));
    return buttons.find((b) => b.textContent?.trim().includes(needle)) ?? null;
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`button not found: ${text}`);
  await el.click();
}

// ─── 1: Admin loads /categories → GET 200 + empty render ──────────────
{
  console.log('\n[admin] /categories list-load round-trip');
  const page = await browser.newPage();
  const calls = captureCategoryCalls(page);
  await seedAdmin(page);
  await page.goto('http://localhost:4202/categories', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const list = calls.find((c) => c.method === 'GET' && c.status === 200);
  if (!list) fail('expected GET /api/categories 200 on page load');
  else ok('GET /api/categories 200 on page load');

  // Body of the list endpoint should be JSON we can parse via the page DOM.
  // The page header label includes the count.
  const headerText = await page.evaluate(() => {
    const h = document.querySelector('section.card h3');
    return h?.textContent ?? '';
  });
  if (!/\d+ categories/.test(headerText)) fail(`unexpected count header: "${headerText}"`);
  else ok(`list count rendered: "${headerText.trim()}"`);

  await page.close();
}

// ─── 2: Create flow → POST 200 + row appears ──────────────────────────
const probeSlug = `probe-${Date.now()}`;
const probeName = `Probe Cat ${Date.now()}`;
{
  console.log('\n[admin] /categories create flow');
  const page = await browser.newPage();
  const calls = captureCategoryCalls(page);
  await seedAdmin(page);
  await page.goto('http://localhost:4202/categories', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));

  await setInputByLabel(page, 'Slug', probeSlug);
  await setInputByLabel(page, 'Name', probeName);
  await setInputByLabel(page, 'Description', 'created by probe');

  await clickButtonByText(page, 'Create');
  await new Promise((r) => setTimeout(r, 1000));

  const post = calls.find(
    (c) => c.method === 'POST' && c.url.endsWith('/api/categories'),
  );
  if (!post) fail('expected POST /api/categories');
  else if (post.status !== 201)
    fail(`POST /api/categories returned ${post.status}, expected 201`);
  else if (!post.reqBody?.includes(`"slug":"${probeSlug}"`))
    fail(`POST body missing slug: ${post.reqBody}`);
  else if (!post.headers['idempotency-key'])
    fail('POST missing Idempotency-Key header');
  else ok(`POST /api/categories 201 with slug + Idempotency-Key`);

  // Confirm row appears in the table.
  const rendered = await page.evaluate(
    (slug) => Array.from(document.querySelectorAll('td')).some((td) => td.textContent?.includes(slug)),
    probeSlug,
  );
  if (!rendered) fail(`new category row not rendered`);
  else ok(`row rendered in table: ${probeSlug}`);

  await page.close();
}

// ─── 3: Edit flow → PATCH 200 + name updated ──────────────────────────
const renamedName = `${probeName} Renamed`;
{
  console.log('\n[admin] /categories edit flow');
  const page = await browser.newPage();
  const calls = captureCategoryCalls(page);
  await seedAdmin(page);
  await page.goto('http://localhost:4202/categories', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));

  // Click the Edit button on the row whose slug matches probeSlug.
  await page.evaluate((slug) => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const row = rows.find((r) => r.textContent?.includes(slug));
    if (!row) throw new Error(`row not found for slug ${slug}`);
    const editBtn = Array.from(row.querySelectorAll('cdf-button button')).find(
      (b) => b.textContent?.trim() === 'Edit',
    );
    if (!editBtn) throw new Error('edit button missing');
    editBtn.click();
  }, probeSlug);
  await new Promise((r) => setTimeout(r, 300));

  await setInputByLabel(page, 'Name', renamedName);
  await clickButtonByText(page, 'Save changes');
  await new Promise((r) => setTimeout(r, 1000));

  const patch = calls.find(
    (c) => c.method === 'PATCH' && c.url.includes('/api/categories/'),
  );
  if (!patch) fail('expected PATCH /api/categories/:id');
  else if (patch.status !== 200) fail(`PATCH returned ${patch.status}`);
  else if (!patch.reqBody?.includes(`"name":"${renamedName}"`))
    fail(`PATCH body missing renamed name: ${patch.reqBody}`);
  else ok(`PATCH /api/categories/:id 200 with renamed name`);

  await page.close();
}

// ─── 4: STUDENT can list but not POST ─────────────────────────────────
{
  console.log('\n[student-via-API] role guard check');
  const res = await fetch('http://localhost:3000/api/categories', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dev-token-student',
    },
    body: JSON.stringify({ slug: 'sneaky', name: 'Should Not Land' }),
  });
  if (res.status !== 403) fail(`expected 403 for STUDENT POST, got ${res.status}`);
  else ok('STUDENT POST → 403 forbidden');
}

// ─── 5: ADMIN delete → DELETE 204 + row gone ──────────────────────────
{
  console.log('\n[admin] /categories delete flow (via API for determinism)');
  const list = await fetch('http://localhost:3000/api/categories', {
    headers: { Authorization: 'Bearer dev-token-admin' },
  });
  const listBody = await list.json();
  const target = listBody.items.find((c) => c.slug === probeSlug);
  if (!target) fail(`probe row missing from list before delete`);
  else {
    const del = await fetch(
      `http://localhost:3000/api/categories/${encodeURIComponent(target.id)}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer dev-token-admin' },
      },
    );
    if (del.status !== 204) fail(`DELETE returned ${del.status}, expected 204`);
    else ok(`DELETE /api/categories/:id 204`);

    const after = await fetch('http://localhost:3000/api/categories', {
      headers: { Authorization: 'Bearer dev-token-admin' },
    });
    const afterBody = await after.json();
    const stillThere = afterBody.items.find((c) => c.slug === probeSlug);
    if (stillThere) fail('soft-deleted category still appears in list');
    else ok('soft-deleted category gone from list');
  }
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} probe(s) failed`);
  process.exit(1);
}
console.log('\nAll Phase 5b probes passed');
