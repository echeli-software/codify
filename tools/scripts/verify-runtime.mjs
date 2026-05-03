#!/usr/bin/env node
/**
 * Headless-Chrome runtime verification.
 *
 * For each configured app, navigates through one or more routes, waits for
 * content to render, and asserts:
 *   - No console.error / console.warn emitted (configurable per-app)
 *   - No uncaught page errors
 *   - No failed network requests
 *   - Required DOM selectors present per route
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
 * @typedef {Object} RouteCheck
 * @property {string} path             URL path (without origin).
 * @property {string[]} expectSelectors Selectors that must exist on this route.
 *
 * @typedef {Object} AppCheck
 * @property {string} name
 * @property {string} origin
 * @property {RouteCheck[]} routes
 * @property {RegExp[]} ignoreConsole  Console messages matching these are not errors.
 */

/** @type {AppCheck[]} */
const APPS = [
  {
    name: 'admin',
    origin: 'http://localhost:4202',
    routes: [
      {
        path: '/playground',
        expectSelectors: [
          'app-root',
          '.cdf-shell',
          '.cdf-shell__brand',
          '.cdf-button',
          '.cdf-badge',
          '.cdf-input',
          '.cdf-form-field',
        ],
      },
      {
        path: '/courses',
        expectSelectors: [
          'app-root',
          '.cdf-shell',
          '.cdf-table',
          '.cdf-table th', // sortable headers rendered
        ],
      },
      {
        path: '/lessons',
        expectSelectors: [
          'app-root',
          '.cdf-shell',
          '.cdf-lesson-editor',
          '.cdf-lesson-editor__toolbar',
          '.cdf-lesson-editor__surface .ProseMirror',
        ],
      },
    ],
    ignoreConsole: [
      /\[vite\]/i,
      /Angular is running in development mode/i,
      /TranslationKey\b.*not found/i,
    ],
  },
  {
    name: 'student',
    origin: 'http://localhost:4201',
    routes: [
      {
        path: '/today',
        expectSelectors: [
          'app-root',
          'ion-app',
          'ion-router-outlet',
          'ion-content',
          'ion-card',
          'ion-progress-bar',
        ],
      },
    ],
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
  for (const route of app.routes) {
    const url = app.origin + route.path;
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

    try {
      process.stdout.write(`Checking ${app.name} ${route.path} … `);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });
      for (const sel of route.expectSelectors) {
        const found = await page.$(sel);
        if (!found) {
          errors.push(`[missing-element] selector "${sel}" not found`);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      errors.push(`[navigation] ${err.message}`);
    } finally {
      await page.close();
    }

    if (errors.length > 0) {
      failed += 1;
      console.log('FAIL');
      for (const e of errors) console.log('   ' + e);
    } else {
      console.log('OK');
    }
  }
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
