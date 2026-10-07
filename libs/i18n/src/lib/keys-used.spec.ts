import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Every literal translation key used by the shared UI libraries must exist
 * in both pt-BR and en-US (docs/11 §11 "Build fails if any user-facing
 * component has a key with no entry in the default locale").
 */
describe('translation keys used by the UI libraries', () => {
  it('all exist in pt-BR and en-US', () => {
    const root = join(__dirname, '../../../..');
    const out = execFileSync(
      process.execPath,
      [join(root, 'tools/scripts/check-i18n-keys.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    expect(out).toMatch(/i18n keys OK/);
  });
});
