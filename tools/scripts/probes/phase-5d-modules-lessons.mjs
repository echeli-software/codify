#!/usr/bin/env node
/**
 * Phase 5d probe — module + lesson CRUD + lesson editor save round-trip.
 *
 *   1. Create a parent Course via API (so the probe doesn't need to drive
 *      that flow again).
 *   2. /courses/:slug → list shows 0 modules.
 *   3. Add module via inline form → POST 201 + row appears.
 *   4. Add lesson via per-module form → POST 201 + row appears.
 *   5. Click lesson title → /lessons/:id loads, GET 200, contentJson present.
 *   6. Edit Tiptap contents + Save → PATCH 200 with contentJson in body.
 *   7. Reload lesson → updated contentJson persisted.
 *   8. STUDENT GET draft lesson → 404 (course unpublished).
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const ADMIN_AUTH = 'Bearer dev-token-admin';
const TEACHER_AUTH = 'Bearer dev-token-teacher';
const STUDENT_AUTH = 'Bearer dev-token-student';

const browser = await puppeteer.launch({ headless: 'shell' });
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error('  FAIL:', msg);
};
const ok = (msg) => console.log('  OK:', msg);

function captureCalls(page, prefix) {
  const calls = [];
  page.on('request', (req) => {
    if (!req.url().includes(prefix)) return;
    calls.push({
      request: req,
      method: req.method(),
      url: req.url(),
      reqBody: req.postData() ?? undefined,
      headers: req.headers(),
      status: 0,
    });
  });
  page.on('response', (res) => {
    if (!res.url().includes(prefix)) return;
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
    return (
      buttons.find((b) => b.textContent?.trim() === needle) ??
      buttons.find((b) => b.textContent?.trim().includes(needle)) ??
      null
    );
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`button not found: ${text}`);
  await el.click();
}

const slug = `probe5d-${Date.now()}`;
const courseTitle = `Probe 5d Course ${Date.now()}`;
const moduleTitle = `Module One`;
const lessonTitle = `Lesson One`;
let courseId = null;
let moduleId = null;
let lessonId = null;

// ─── Setup: create a Course via API ───────────────────────────────────
{
  console.log('\n[setup] create course via API');
  const res = await fetch('http://localhost:3000/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ADMIN_AUTH },
    body: JSON.stringify({ slug, title: courseTitle }),
  });
  if (res.status !== 201) fail(`expected 201, got ${res.status}`);
  else {
    const body = await res.json();
    courseId = body.id;
    ok(`course created: ${courseId}`);
  }
}

// ─── 1: Course detail page loads with 0 modules ───────────────────────
{
  console.log('\n[admin] /courses/:slug list-load');
  const page = await browser.newPage();
  const calls = captureCalls(page, '/api/');
  await seedAdmin(page);
  await page.goto(`http://localhost:4202/courses/${slug}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  const detail = calls.find(
    (c) => c.method === 'GET' && c.url.endsWith(`/api/courses/${slug}`) && c.status === 200,
  );
  if (!detail) fail('expected GET /api/courses/:slug 200');
  else ok('GET /api/courses/:slug 200');

  const list = calls.find(
    (c) =>
      c.method === 'GET' &&
      c.url.endsWith(`/api/courses/${courseId}/modules`) &&
      c.status === 200,
  );
  if (!list) fail('expected GET /api/courses/:id/modules 200');
  else ok('GET /api/courses/:id/modules 200');

  const text = await page.evaluate(() => document.body.innerText);
  if (!text.includes(courseTitle)) fail(`page header missing course title`);
  else ok(`page header shows "${courseTitle}"`);
  if (!text.toLowerCase().includes('no modules yet'))
    fail(`expected empty-state copy "No modules yet"`);
  else ok('empty state rendered');

  await page.close();
}

// ─── 2: Create module ─────────────────────────────────────────────────
{
  console.log('\n[admin] create module');
  const page = await browser.newPage();
  const calls = captureCalls(page, '/api/');
  await seedAdmin(page);
  await page.goto(`http://localhost:4202/courses/${slug}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  await clickButtonByText(page, 'Add module');
  await new Promise((r) => setTimeout(r, 200));
  await setInputByLabel(page, 'Module title', moduleTitle);
  await clickButtonByText(page, 'Create module');
  await new Promise((r) => setTimeout(r, 1000));

  const post = calls.find(
    (c) => c.method === 'POST' && c.url.endsWith(`/api/courses/${courseId}/modules`),
  );
  if (!post) fail('expected POST /api/courses/:id/modules');
  else if (post.status !== 201) fail(`POST returned ${post.status}`);
  else if (!post.reqBody?.includes(`"title":"${moduleTitle}"`))
    fail(`POST body missing title: ${post.reqBody}`);
  else if (!post.headers['idempotency-key'])
    fail('POST missing Idempotency-Key');
  else ok(`POST module 201 with title + Idempotency-Key`);

  const moduleVisible = await page.evaluate(
    (t) => Array.from(document.querySelectorAll('h3')).some((h) => h.textContent?.includes(t)),
    moduleTitle,
  );
  if (!moduleVisible) fail('module not rendered in list');
  else ok(`module rendered: ${moduleTitle}`);

  // Capture moduleId for the lesson step.
  const list = await fetch(`http://localhost:3000/api/courses/${courseId}/modules`, {
    headers: { Authorization: ADMIN_AUTH },
  });
  const body = await list.json();
  moduleId = body.find((m) => m.title === moduleTitle)?.id ?? null;
  if (!moduleId) fail('module id not found via API');

  await page.close();
}

// ─── 3: Create lesson ─────────────────────────────────────────────────
{
  console.log('\n[admin] create lesson');
  const page = await browser.newPage();
  const calls = captureCalls(page, '/api/');
  await seedAdmin(page);
  await page.goto(`http://localhost:4202/courses/${slug}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  // Open the per-module Add lesson form for the module we created above.
  await page.evaluate((mTitle) => {
    const modules = Array.from(document.querySelectorAll('li.module'));
    const li = modules.find((m) => m.querySelector('h3')?.textContent?.includes(mTitle));
    if (!li) throw new Error('module li not found');
    const btn = Array.from(li.querySelectorAll('cdf-button button')).find(
      (b) => b.textContent?.trim() === 'Add lesson',
    );
    if (!btn) throw new Error('Add lesson button missing');
    btn.click();
  }, moduleTitle);
  await new Promise((r) => setTimeout(r, 200));
  await setInputByLabel(page, 'Lesson title', lessonTitle);
  await clickButtonByText(page, 'Create lesson');
  await new Promise((r) => setTimeout(r, 1000));

  const post = calls.find(
    (c) => c.method === 'POST' && c.url.endsWith(`/api/modules/${moduleId}/lessons`),
  );
  if (!post) fail('expected POST /api/modules/:id/lessons');
  else if (post.status !== 201) fail(`POST returned ${post.status}`);
  else if (!post.reqBody?.includes(`"title":"${lessonTitle}"`))
    fail(`POST body missing title: ${post.reqBody}`);
  else ok(`POST lesson 201 with title`);

  const lessonVisible = await page.evaluate(
    (t) =>
      Array.from(document.querySelectorAll('a.lesson-title')).some(
        (a) => a.textContent?.trim() === t,
      ),
    lessonTitle,
  );
  if (!lessonVisible) fail('lesson row not rendered');
  else ok(`lesson rendered in module: ${lessonTitle}`);

  // Capture lessonId for the editor step.
  const list = await fetch(`http://localhost:3000/api/courses/${courseId}/modules`, {
    headers: { Authorization: ADMIN_AUTH },
  });
  const mods = await list.json();
  // Modules-list endpoint doesn't include lessons. Hit GET /api/courses/:slug for them.
  const detail = await fetch(`http://localhost:3000/api/courses/${slug}`, {
    headers: { Authorization: ADMIN_AUTH },
  });
  const courseDetail = await detail.json();
  const targetModule = courseDetail.modules.find((m) => m.id === moduleId);
  lessonId = targetModule?.lessons?.find((l) => l.title === lessonTitle)?.id ?? null;
  if (!lessonId) fail('lesson id not resolvable from detail');

  await page.close();
}

// ─── 4: Lesson editor save round-trip ─────────────────────────────────
{
  console.log('\n[admin] /lessons/:id editor save');
  if (!lessonId) {
    fail('skipped — no lesson id');
  } else {
    const page = await browser.newPage();
    const calls = captureCalls(page, '/api/');
    await seedAdmin(page);
    await page.goto(`http://localhost:4202/lessons/${lessonId}`, {
      waitUntil: 'networkidle2',
    });
    await new Promise((r) => setTimeout(r, 1500));

    const get = calls.find(
      (c) =>
        c.method === 'GET' &&
        c.url.endsWith(`/api/lessons/${lessonId}`) &&
        c.status === 200,
    );
    if (!get) fail('expected GET /api/lessons/:id 200');
    else ok('GET /api/lessons/:id 200');

    // Type into the Tiptap ProseMirror element to mark dirty.
    const proseMirrorPresent = await page.$('.ProseMirror');
    if (!proseMirrorPresent) {
      fail('LessonBlockEditor (.ProseMirror) not rendered');
    } else {
      await page.click('.ProseMirror');
      await page.keyboard.type('Hello from probe ');
      await new Promise((r) => setTimeout(r, 300));
      // Save button — labeled "Save changes" while dirty, "Saved" when clean.
      await clickButtonByText(page, 'Save changes');
      await new Promise((r) => setTimeout(r, 1500));

      const patch = calls.find(
        (c) =>
          c.method === 'PATCH' &&
          c.url.endsWith(`/api/lessons/${lessonId}`),
      );
      if (!patch) fail('expected PATCH /api/lessons/:id');
      else if (patch.status !== 200) fail(`PATCH returned ${patch.status}`);
      else if (!patch.reqBody?.includes('"contentJson"'))
        fail(`PATCH body missing contentJson: ${patch.reqBody}`);
      else if (!patch.reqBody?.includes('Hello from probe'))
        fail(`PATCH body missing typed text: ${patch.reqBody}`);
      else ok('PATCH lesson 200 with edited contentJson in body');
    }

    await page.close();
  }
}

// ─── 5: Persistence check via API ─────────────────────────────────────
{
  console.log('\n[verify] persisted contentJson via API');
  if (!lessonId) {
    fail('skipped — no lesson id');
  } else {
    const res = await fetch(`http://localhost:3000/api/lessons/${lessonId}`, {
      headers: { Authorization: ADMIN_AUTH },
    });
    const body = await res.json();
    const json = JSON.stringify(body.contentJson);
    if (!json.includes('Hello from probe'))
      fail(`server response missing typed text: ${json}`);
    else ok('persisted contentJson contains typed text');
  }
}

// ─── 6: STUDENT 404 on draft lesson ───────────────────────────────────
{
  console.log('\n[student-via-API] 404 on draft lesson');
  if (!lessonId) {
    fail('skipped — no lesson id');
  } else {
    const res = await fetch(`http://localhost:3000/api/lessons/${lessonId}`, {
      headers: { Authorization: STUDENT_AUTH },
    });
    if (res.status !== 404) fail(`expected 404 for STUDENT, got ${res.status}`);
    else ok('STUDENT GET draft lesson → 404');
  }
}

// ─── 7: TEACHER cannot mutate other admin's course ────────────────────
{
  console.log('\n[teacher-via-API] 403 on others course');
  const res = await fetch(
    `http://localhost:3000/api/courses/${courseId}/modules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: TEACHER_AUTH },
      body: JSON.stringify({ title: 'sneaky' }),
    },
  );
  if (res.status !== 403) fail(`expected 403, got ${res.status}`);
  else ok('TEACHER POST module on others course → 403');
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} probe(s) failed`);
  process.exit(1);
}
console.log('\nAll Phase 5d probes passed');
