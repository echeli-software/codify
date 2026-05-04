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
    /** Stub auth — admin app is staff-only so we sign in as ADMIN. */
    seed: {
      'codify.auth.user': JSON.stringify({
        id: 'dev-admin',
        email: 'admin@codify.local',
        displayName: 'Admin',
        role: 'ADMIN',
        avatarUrl: null,
        locale: 'pt-BR',
      }),
      'codify.auth.token': JSON.stringify({ token: 'dev-token-admin', expiresAt: null }),
    },
    routes: [
      {
        path: '/login',
        public: true,
        expectSelectors: ['app-root', '.role-btn'],
      },
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
      {
        path: '/profile',
        expectSelectors: [
          'app-root',
          '.cdf-shell',
          '.profile-page',
          '.cdf-input',
          '.cdf-select',
          '.cdf-kv',
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
    /** Stub auth — seeds localStorage so the authGuard lets us through. */
    seed: {
      'codify.auth.user': JSON.stringify({
        id: 'dev-student',
        email: 'student@codify.local',
        displayName: 'Maria Souza',
        role: 'STUDENT',
        avatarUrl: null,
        locale: 'pt-BR',
      }),
      'codify.auth.token': JSON.stringify({ token: 'dev-token-student', expiresAt: null }),
    },
    routes: [
      {
        path: '/login',
        public: true,
        expectSelectors: ['app-root', 'ion-content', '.role-btn'],
      },
      {
        path: '/today',
        expectSelectors: [
          'app-root',
          'ion-app',
          'ion-tabs',
          'ion-tab-bar',
          'ion-content',
          'ion-card',
          'ion-progress-bar',
          'cdf-streak-widget',
          'cdf-daily-quest-list',
        ],
      },
      {
        path: '/catalog',
        expectSelectors: ['app-root', 'ion-tabs', 'ion-content', '.cdf-empty'],
      },
      {
        path: '/avatar',
        expectSelectors: ['app-root', 'ion-tabs', 'ion-content', '.cdf-empty'],
      },
      {
        path: '/shop',
        expectSelectors: ['app-root', 'ion-tabs', 'ion-content', '.cdf-empty'],
      },
      {
        path: '/profile',
        expectSelectors: [
          'app-root',
          'ion-tabs',
          'ion-content',
          '.profile-hero',
          'cdf-app-input',
          'cdf-app-select',
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
      // Seed localStorage on the app's origin so the authGuard sees a
      // signed-in user before the SPA bootstraps. Public routes skip this.
      if (app.seed && !route.public) {
        await page.goto(app.origin + '/login', { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
        await page.evaluate((seed) => {
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        }, app.seed);
      }
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
