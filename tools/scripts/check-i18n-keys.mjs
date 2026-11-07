#!/usr/bin/env node
/**
 * Verifies that every literal translation key used by the shared libraries
 * (`'ui.…'`, `'common.…'`, `'gamification.…'`, `'billing.…'`, `'time.…'`)
 * exists in BOTH pt-BR and en-US under libs/i18n/src/strings.
 *
 *   node tools/scripts/check-i18n-keys.mjs [dirs…]   (default: the UI libs)
 *
 * Dynamic keys (`'ui.item.slot.' + slot`) are checked by prefix: at least
 * one key must exist under that prefix.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'libs/ui-bootstrap/src',
      'libs/ui-ionic/src',
      'libs/gamification-engine/src',
      'libs/i18n/src/lib',
    ];
const NS = /^(ui|common|gamification|billing|time)\./;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name))
      out.push(p);
  }
  return out;
}

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

function bundle(locale) {
  const dir = join(root, 'libs/i18n/src/strings', locale);
  const merged = {};
  for (const f of readdirSync(dir))
    Object.assign(merged, JSON.parse(readFileSync(join(dir, f), 'utf8')));
  return flatten(merged);
}

const locales = { 'pt-BR': bundle('pt-BR'), 'en-US': bundle('en-US') };
const missing = [];
let used = 0;
for (const dir of dirs) {
  for (const file of walk(join(root, dir))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(
      /['`]((?:ui|common|gamification|billing|time)\.[A-Za-z0-9_.]+)['`]/g,
    )) {
      const key = m[1];
      if (!NS.test(key)) continue;
      used++;
      for (const [loc, keys] of Object.entries(locales)) {
        const ok = key.endsWith('.')
          ? [...keys].some((k) => k.startsWith(key))
          : keys.has(key);
        if (!ok)
          missing.push(`${loc}  ${key}  (${file.replace(root + '/', '')})`);
      }
    }
  }
}
if (missing.length) {
  console.error(
    `Missing translation keys (${missing.length}):\n${[...new Set(missing)].join('\n')}`,
  );
  process.exit(1);
}
console.log(`i18n keys OK — ${used} usages checked against pt-BR and en-US.`);
