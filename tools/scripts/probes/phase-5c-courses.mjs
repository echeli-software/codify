#!/usr/bin/env node
/**
 * Phase 5c probe — admin Courses CRUD via /api/courses + ContentTranslation.
 *
 * Headless Chrome drives /courses and asserts:
 *   1. List loads through GET /api/courses 200, count rendered.
 *   2. Create-form submit → POST 201 with title + slug, row appears.
 *   3. Publish action → POST /:id/publish 200, status badge flips.
 *   4. STUDENT POST → 403 (API-side; UI doesn't expose it).
 *   5. Title via Accept-Language en-US falls back to source pt-BR.
 *   6. Soft-delete makes the row vanish from list.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'shell' });
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error('  FAIL:', msg);
};
const ok = (msg) => console.log('  OK:', msg);

function captureCourseCalls(page) {
  const calls = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/courses') || url.includes('/api/me')) {
      calls.push({
        request: req,
        method: req.method(),
        url,
        headers: req.headers(),
        reqBody: req.postData() ?? undefined,
        status: 0,
      });
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/courses') || url.includes('/api/me')) {
      const entry = calls.find((c) => c.request === res.request());
      if (entry) entry.status = res.status();
    }
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
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      if (setter) setter.call(input, value);
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

const probeSlug = `probe-${Date.now()}`;
const probeTitle = `Probe Course ${Date.now()}`;
let createdId = null;

// ─── 1: list load ─────────────────────────────────────────────────────
{
  console.log('\n[admin] /courses list-load');
  const page = await browser.newPage();
  const calls = captureCourseCalls(page);
  await seedAdmin(page);
  await page.goto('http://localhost:4202/courses', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const list = calls.find(
    (c) => c.method === 'GET' && c.status === 200 && c.url.includes('/api/courses'),
  );
  if (!list) fail('expected GET /api/courses 200 on page load');
  else ok('GET /api/courses 200 on page load');
  const text = await page.evaluate(() => document.body.innerText);
  if (!/Showing \d+ of \d+ courses/.test(text))
    fail(`unexpected list-meta text: missing "Showing N of M courses"`);
  else ok('list meta rendered');
  await page.close();
}

// ─── 2: create flow ───────────────────────────────────────────────────
{
  console.log('\n[admin] /courses create flow');
  const page = await browser.newPage();
  const calls = captureCourseCalls(page);
  await seedAdmin(page);
  await page.goto('http://localhost:4202/courses', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  await clickButtonByText(page, 'New course');
  await new Promise((r) => setTimeout(r, 200));
  await setInputByLabel(page, 'Title', probeTitle);
  await setInputByLabel(page, 'Slug', probeSlug);
  await setInputByLabel(page, 'Description', 'created by probe');
  await clickButtonByText(page, 'Create draft');
  await new Promise((r) => setTimeout(r, 1200));

  const post = calls.find(
    (c) => c.method === 'POST' && c.url.endsWith('/api/courses'),
  );
  if (!post) fail('expected POST /api/courses');
  else if (post.status !== 201) fail(`POST returned ${post.status}, expected 201`);
  else if (!post.reqBody?.includes(`"slug":"${probeSlug}"`))
    fail(`POST body missing slug: ${post.reqBody}`);
  else if (!post.headers['idempotency-key'])
    fail('POST missing Idempotency-Key header');
  else ok('POST /api/courses 201 with Idempotency-Key + slug in body');

  const rowAppears = await page.evaluate(
    (slug) =>
      Array.from(document.querySelectorAll('a.title-link')).some(
        (a) => a.getAttribute('href')?.endsWith(`/courses/${slug}`),
      ),
    probeSlug,
  );
  if (!rowAppears) fail('new course row not in table');
  else ok(`row rendered: ${probeSlug}`);

  // Capture id for later steps.
  const adminGet = await fetch('http://localhost:3000/api/courses?status=DRAFT', {
    headers: { Authorization: 'Bearer dev-token-admin' },
  });
  const body = await adminGet.json();
  createdId = body.items.find((c) => c.slug === probeSlug)?.id ?? null;
  if (!createdId) fail('could not find created course id');

  await page.close();
}

// ─── 3: publish flow ──────────────────────────────────────────────────
{
  console.log('\n[admin] /courses publish flow');
  const page = await browser.newPage();
  const calls = captureCourseCalls(page);
  await seedAdmin(page);
  await page.goto('http://localhost:4202/courses', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // Click the Publish button on the row whose title-link points to the probe slug.
  await page.evaluate((slug) => {
    const link = Array.from(document.querySelectorAll('a.title-link')).find(
      (a) => a.getAttribute('href')?.endsWith(`/courses/${slug}`),
    );
    if (!link) throw new Error('row not found');
    const tr = link.closest('tr');
    const btn = Array.from(tr.querySelectorAll('cdf-button button')).find(
      (b) => b.textContent?.trim() === 'Publish',
    );
    if (!btn) throw new Error('publish button missing');
    btn.click();
  }, probeSlug);
  await new Promise((r) => setTimeout(r, 1200));

  const publish = calls.find(
    (c) => c.method === 'POST' && c.url.includes(`/api/courses/`) && c.url.endsWith('/publish'),
  );
  if (!publish) fail('expected POST /api/courses/:id/publish');
  else if (publish.status !== 201 && publish.status !== 200)
    fail(`publish returned ${publish.status}`);
  else ok(`POST /api/courses/:id/publish ${publish.status}`);

  const badge = await page.evaluate((slug) => {
    const link = Array.from(document.querySelectorAll('a.title-link')).find(
      (a) => a.getAttribute('href')?.endsWith(`/courses/${slug}`),
    );
    const tr = link?.closest('tr');
    return tr?.querySelector('cdf-badge')?.textContent?.trim() ?? null;
  }, probeSlug);
  if (badge !== 'PUBLISHED') fail(`status badge is "${badge}", expected PUBLISHED`);
  else ok('status badge flipped to PUBLISHED');

  await page.close();
}

// ─── 4: STUDENT POST forbidden ────────────────────────────────────────
{
  console.log('\n[student-via-API] role guard');
  const res = await fetch('http://localhost:3000/api/courses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dev-token-student',
    },
    body: JSON.stringify({ slug: 'sneaky-x', title: 'Should Not Land' }),
  });
  if (res.status !== 403) fail(`expected 403, got ${res.status}`);
  else ok('STUDENT POST → 403');
}

// ─── 5: locale fallback ───────────────────────────────────────────────
{
  console.log('\n[locale] en-US falls back to source pt-BR');
  const res = await fetch(`http://localhost:3000/api/courses/${probeSlug}`, {
    headers: {
      'Accept-Language': 'en-US',
      Authorization: 'Bearer dev-token-admin',
    },
  });
  const body = await res.json();
  if (body.title !== probeTitle)
    fail(`expected source-locale title "${probeTitle}", got "${body.title}"`);
  else if (body.titleFromTranslation !== false)
    fail(`titleFromTranslation should be false (came from source-locale row)`);
  else ok(`source-locale title returned: "${body.title}"`);
}

// ─── 6: soft-delete ───────────────────────────────────────────────────
{
  console.log('\n[admin] DELETE');
  if (!createdId) {
    fail('skipped — no createdId');
  } else {
    const del = await fetch(
      `http://localhost:3000/api/courses/${createdId}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer dev-token-admin' },
      },
    );
    if (del.status !== 204) fail(`DELETE returned ${del.status}, expected 204`);
    else ok(`DELETE /api/courses/:id 204`);

    const after = await fetch('http://localhost:3000/api/courses', {
      headers: { Authorization: 'Bearer dev-token-admin' },
    });
    const afterBody = await after.json();
    const stillThere = afterBody.items.find((c) => c.slug === probeSlug);
    if (stillThere) fail('soft-deleted course still in list');
    else ok('soft-deleted course gone from list');
  }
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} probe(s) failed`);
  process.exit(1);
}
console.log('\nAll Phase 5c probes passed');
