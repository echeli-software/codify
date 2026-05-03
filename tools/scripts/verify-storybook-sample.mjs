#!/usr/bin/env node
/**
 * Headless verification for a representative sample of Storybook stories.
 * Loads each iframe URL, captures console.error / pageerror, asserts none.
 *
 * Assumes `pnpm nx storybook ui-bootstrap` is already running on :4400.
 *
 * Note: story IDs are kebab-cased title (no hyphens between words like
 * "PriceTag" → "pricetag") + "--" + kebab-cased export name.
 */
import puppeteer from 'puppeteer';

const STORIES = [
  'atoms-button--all-variants',
  'atoms-icon--all-icons',
  'atoms-badge--all-variants',
  'atoms-input--default',
  'atoms-tooltip--placement-variants',
  'molecules-formfield--default',
  'molecules-pagination--many',
  'molecules-pricetag--annual-brl-with-installments',
  'molecules-toast--interactive',
  'organisms-appshell--default',
  'organisms-datatable--sortable-with-bulk-select',
  'organisms-moneyinput--brl',
  'organisms-jsoneditor--default',
  'organisms-lessonblockeditor--sample-doc',
  'organisms-lessonblockrenderer--sample',
];

const IGNORE = [
  /\[vite\]/i,
  /Angular is running in development mode/i,
  /TranslationKey\b.*not found/i,
];

const browser = await puppeteer.launch({ headless: 'shell' });
let failed = 0;

for (const id of STORIES) {
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    if (IGNORE.some((re) => re.test(m.text()))) return;
    errors.push(`[console.${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  process.stdout.write(`Story ${id} … `);
  try {
    await page.goto(`http://localhost:4400/iframe.html?id=${id}&viewMode=story`, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    });
    await new Promise((r) => setTimeout(r, 600));
  } catch (e) {
    errors.push(`[navigation] ${e.message}`);
  } finally {
    await page.close();
  }
  if (errors.length) {
    failed++;
    console.log('FAIL');
    for (const e of errors) console.log('   ' + e);
  } else {
    console.log('OK');
  }
}
await browser.close();
process.exit(failed > 0 ? 1 : 0);
