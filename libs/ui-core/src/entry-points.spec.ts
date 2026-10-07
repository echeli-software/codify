import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as root from './index.js';
import * as color from './lib/color/index.js';
import * as format from './lib/format/index.js';
import * as level from './lib/level/index.js';
import * as random from './lib/random/index.js';
import * as validate from './lib/validate/index.js';

const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as { exports: Record<string, string | Record<string, string>> };

describe('per-module entry points (docs/03 "tree-shakable")', () => {
  const modules = { format, level, validate, color, random };

  it.each(Object.keys(modules))(
    'package.json exports ./%s to an existing file',
    (name) => {
      const entry = pkg.exports[`./${name}`] as Record<string, string>;
      expect(entry).toBeDefined();
      for (const target of Object.values(entry)) {
        expect(existsSync(join(__dirname, '..', target))).toBe(true);
      }
    },
  );

  it('the root barrel re-exports every subpath symbol unchanged', () => {
    for (const mod of Object.values(modules)) {
      for (const [key, value] of Object.entries(mod)) {
        expect((root as Record<string, unknown>)[key]).toBe(value);
      }
    }
  });
});
