#!/usr/bin/env node
/**
 * Headless verification of the ui-ionic Storybook build. Loads a small
 * sample of stories via their iframe URL and asserts:
 *   - No console errors / page errors
 *   - The story root renders something
 *
 * Assumes Storybook is being served on http://localhost:4401.
 */

import puppeteer from 'puppeteer';

const ORIGIN = 'http://localhost:4401';
const STORIES = [
  'atoms-icon--default',
  'atoms-icon--catalog',
  'atoms-appbutton--primary',
  'atoms-appbutton--all-variants',
  'atoms-appcard--default',
  'atoms-appbadge--all-variants',
  'atoms-coinbadge--default',
  'atoms-xpbadge--default',
  'molecules-levelbadge--tier-progression',
  'molecules-streakchip--week',
  'molecules-xpbar--default',
  'molecules-lessonitem--in-progress',
  'molecules-coursecard--default',
  'molecules-emptystate--default',
  'molecules-rewardtoast--multiplier',
  'molecules-avatarwithframe--default',
  'organisms-dailyquestlist--default',
  'organisms-streakwidget--active',
  'organisms-onboardingcarousel--default',
  'organisms-levelupmodal--silver',
  'organisms-badgeunlockoverlay--week-streak',
  'demo-rewardorchestrator--playground',
];

const browser = await puppeteer.launch({ headless: 'shell' });
let failed = 0;

for (const id of STORIES) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (!['error', 'warning'].includes(msg.type())) return;
    const text = msg.text();
    if (/\[vite\]|Angular is running|Lit is in dev mode|prefers-reduced-motion/i.test(text)) return;
    errors.push(`[console.${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) =>
    errors.push(`[requestfailed] ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`),
  );

  const url = `${ORIGIN}/iframe.html?id=${id}&viewMode=story`;
  try {
    process.stdout.write(`Checking ${id} … `);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    const root = await page.$('#storybook-root');
    if (!root) errors.push('[missing-element] #storybook-root not found');
    else {
      const innerHtml = await page.$eval('#storybook-root', (el) => el.innerHTML.trim());
      if (innerHtml.length === 0) errors.push('[empty-root] #storybook-root is empty');
    }
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

await browser.close();
process.exit(failed > 0 ? 1 : 0);
