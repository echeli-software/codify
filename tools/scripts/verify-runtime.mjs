#!/usr/bin/env node
/**
 * Headless-Chrome runtime verification.
 *
 * Loads each app's dev URL, waits for content to render, and asserts:
 *   - No console.error / console.warn emitted (configurable per-app)
 *   - No uncaught page errors
 *   - At least one expected DOM element is present (per-app sanity check)
 *
 * Usage (assumes dev servers already running on the URLs below):
 *   node tools/scripts/verify-runtime.mjs admin     # check admin only
 *   node tools/scripts/verify-runtime.mjs student   # check student only
 *   node tools/scripts/verify-runtime.mjs           # check all
 *
 * Exit code: 0 on success, 1 on any failure.
 */

import puppeteer from 'puppeteer';

/**
 * @typedef {Object} AppCheck
 * @property {string} name
 * @property {string} url
 * @property {string[]} expectSelectors  At least one element matching each must exist.
 * @property {RegExp[]} ignoreConsole    Console messages matching these are not errors.
 */

/** @type {AppCheck[]} */
const APPS = [
  {
    name: 'admin',
    url: 'http://localhost:4202',
    expectSelectors: ['app-root', '.brand', '.cdf-button', '.cdf-badge', '.cdf-input'],
    ignoreConsole: [
      // Vite dev hints — not real errors.
      /\[vite\]/i,
      /Angular is running in development mode/i,
      // ngx-translate warns about missing keys during locale switch transitions
      /TranslationKey\b.*not found/i,
    ],
  },
  {
    name: 'student',
    url: 'http://localhost:4201',
    expectSelectors: ['app-root', '.brand', '.shell'],
    ignoreConsole: [/\[vite\]/i, /Angular is running in development mode/i],
  },
];

const TIMEOUT_MS = 30_000;

const target = process.argv[2];
const targets = target ? APPS.filter((a) => a.name === target) : APPS;
if (target && targets.length === 0) {
  console.error(`Unknown app: ${target}. Choose from: ${APPS.map((a) => a.name).join(', ')}`);
  process.exit(2);
}

const browser = await puppeteer.launch({ headless: 'shell' });
let failed = 0;

for (const app of targets) {
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    if (!['error', 'warning'].includes(msg.type())) return;
    const text = msg.text();
    if (app.ignoreConsole.some((re) => re.test(text))) return;
    errors.push(`[console.${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    errors.push(`[requestfailed] ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
  });

  let appFailed = false;
  try {
    process.stdout.write(`Checking ${app.name} @ ${app.url} … `);
    await page.goto(app.url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });

    for (const sel of app.expectSelectors) {
      const found = await page.$(sel);
      if (!found) {
        errors.push(`[missing-element] selector "${sel}" not found`);
      }
    }
    // Brief settle for any deferred init
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    errors.push(`[navigation] ${err.message}`);
  } finally {
    await page.close();
  }

  if (errors.length > 0) {
    appFailed = true;
    failed += 1;
    console.log('FAIL');
    for (const e of errors) console.log('   ' + e);
  } else {
    console.log('OK');
  }
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
