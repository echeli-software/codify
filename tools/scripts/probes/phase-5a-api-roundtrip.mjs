#!/usr/bin/env node
/**
 * Phase 5a end-to-end probe.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({ headless: 'shell' });
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error('  FAIL:', msg);
};
const ok = (msg) => console.log('  OK:', msg);

let lastPatchedDisplayName = null;

function captureMeCalls(page) {
  /** @type {Array<{request:any,method:string,headers:Record<string,string>,reqBody?:string,status:number}>} */
  const calls = [];
  page.on('request', (req) => {
    if (!req.url().includes('/api/me')) return;
    calls.push({
      request: req,
      method: req.method(),
      headers: req.headers(),
      reqBody: req.postData() ?? undefined,
      status: 0,
    });
  });
  page.on('response', async (res) => {
    if (!res.url().includes('/api/me')) return;
    const entry = calls.find((c) => c.request === res.request());
    if (entry) entry.status = res.status();
  });
  return calls;
}

// ─── 1+2+3: Student profile round-trip ────────────────────────────────
{
  console.log('\n[student] /profile end-to-end');
  const page = await browser.newPage();
  const calls = captureMeCalls(page);

  await page.goto('http://localhost:4201/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'codify.auth.user',
      JSON.stringify({
        id: 'dev-student',
        email: 'student@codify.local',
        displayName: 'Maria Souza',
        role: 'STUDENT',
        avatarUrl: null,
        locale: 'pt-BR',
      }),
    );
    localStorage.setItem(
      'codify.auth.token',
      JSON.stringify({ token: 'dev-token-student', expiresAt: null }),
    );
  });
  await page.goto('http://localhost:4201/profile', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  const initialGet = calls.find((c) => c.method === 'GET' && c.status === 200);
  if (!initialGet) fail('expected GET /api/me 200 on profile mount');
  else ok('GET /api/me 200 on profile mount');

  if (!initialGet?.headers['accept-language']) {
    fail('expected Accept-Language header on initial GET');
  } else {
    ok(`Accept-Language: ${initialGet.headers['accept-language']} stamped on GET`);
  }

  // Edit display name
  lastPatchedDisplayName = `Probed-${Date.now()}`;
  await page.evaluate((name) => {
    const ionInput = /** @type {any} */ (document.querySelector('cdf-app-input ion-input'));
    if (!ionInput) throw new Error('ion-input not found');
    ionInput.value = name;
    ionInput.dispatchEvent(new CustomEvent('ionInput', { detail: { value: name } }));
  }, lastPatchedDisplayName);
  await new Promise((r) => setTimeout(r, 800));

  const namePatch = calls.find(
    (c) => c.method === 'PATCH' && c.reqBody?.includes(`"displayName":"${lastPatchedDisplayName}"`),
  );
  if (!namePatch) fail('expected PATCH /api/me with new displayName');
  else if (namePatch.status !== 200) fail(`PATCH /api/me returned ${namePatch.status}`);
  else ok(`PATCH /api/me 200 carrying {"displayName":"${lastPatchedDisplayName}"}`);

  // Locale switch → PATCH carries locale en-US AND Accept-Language: en-US
  await page.evaluate(() => {
    const langSelect = /** @type {any} */ (
      document.querySelectorAll('cdf-app-select ion-select')[0]
    );
    if (!langSelect) throw new Error('language select not found');
    langSelect.value = 'en-US';
    langSelect.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'en-US' } }));
  });
  await new Promise((r) => setTimeout(r, 800));

  const localePatch = calls.find(
    (c) => c.method === 'PATCH' && c.reqBody?.includes('"locale":"en-US"'),
  );
  if (!localePatch) fail('expected PATCH /api/me with locale en-US');
  else if (localePatch.status !== 200) fail(`PATCH (locale) returned ${localePatch.status}`);
  else if (localePatch.headers['accept-language'] !== 'en-US')
    fail(
      `PATCH (locale) had Accept-Language ${localePatch.headers['accept-language']}, expected en-US`,
    );
  else ok('Locale switch → PATCH locale en-US AND Accept-Language: en-US, status 200');

  await page.close();
}

// ─── 4: Admin profile round-trip ──────────────────────────────────────
{
  console.log('\n[admin] /profile end-to-end');
  const page = await browser.newPage();
  const calls = captureMeCalls(page);
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
  await page.goto('http://localhost:4202/profile', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const adminGet = calls.find((c) => c.method === 'GET' && c.status === 200);
  if (!adminGet) fail('expected admin GET /api/me 200');
  else ok('admin GET /api/me 200');
  await page.close();
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} probe(s) failed`);
  process.exit(1);
}
console.log('\nAll Phase 5a probes passed');
console.log(`(patched displayName: ${lastPatchedDisplayName})`);
