import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * docs/11 §11: every literal `admin.*` key used by the admin app exists in
 * both pt-BR and en-US, and the two locales define the same admin keys.
 * Dynamic keys (`'admin.roles.' + role`) are checked by prefix.
 */
const ROOT = join(__dirname, '../../../..');

function flatten(
  obj: Record<string, unknown>,
  prefix = '',
  out = new Set<string>(),
) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object')
      flatten(v as Record<string, unknown>, key, out);
    else out.add(key);
  }
  return out;
}

function load(locale: string): Set<string> {
  const file = join(ROOT, 'libs/i18n/src/strings', locale, 'admin.json');
  return flatten(JSON.parse(readFileSync(file, 'utf8')));
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts'))
      out.push(p);
  }
  return out;
}

describe('admin translation keys', () => {
  const pt = load('pt-BR');
  const en = load('en-US');

  it('pt-BR and en-US define the same admin keys', () => {
    expect([...pt].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !pt.has(k))).toEqual([]);
  });

  it('every key used in apps/admin exists in both locales', () => {
    const missing: string[] = [];
    for (const file of sources(join(ROOT, 'apps/admin/src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/['`](admin\.[A-Za-z0-9_.-]+)['`$]/g)) {
        const key = m[1];
        const dynamic = key.endsWith('.') || m[0].endsWith('$');
        for (const [name, keys] of [
          ['pt-BR', pt],
          ['en-US', en],
        ] as const) {
          const ok = dynamic
            ? [...keys].some((k) =>
                k.startsWith(key.endsWith('.') ? key : `${key}.`),
              )
            : keys.has(key);
          if (!ok)
            missing.push(`${name} ${key} (${file.replace(ROOT + '/', '')})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
