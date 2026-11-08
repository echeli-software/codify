import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SECURITY_CONTACT,
  SECURITY_TXT_EXPIRES,
  SecurityTxtController,
  apiSecurityTxtCanonical,
  securityTxt,
} from './security-txt.js';

const root = join(__dirname, '../../../../..');
const field = (txt: string, name: string) =>
  txt
    .split('\n')
    .filter((l) => l.startsWith(`${name}:`))
    .map((l) => l.slice(name.length + 1).trim());

describe('security.txt (RFC 9116, docs/14 §19)', () => {
  it('has the required Contact + a single Expires, no more than a year out', () => {
    const txt = securityTxt();
    expect(field(txt, 'Contact')).toEqual([SECURITY_CONTACT]);
    expect(field(txt, 'Expires')).toEqual([SECURITY_TXT_EXPIRES]);
    const expires = Date.parse(SECURITY_TXT_EXPIRES);
    expect(Number.isNaN(expires)).toBe(false);
    // Fails a month before expiry so someone renews it (and re-confirms the contact).
    expect(expires - Date.now()).toBeGreaterThan(30 * 86_400_000);
    expect(expires - Date.now()).toBeLessThan(400 * 86_400_000);
  });

  it.each([
    ['student', 'https://codify.app/.well-known/security.txt'],
    ['admin', 'https://admin.codify.app/.well-known/security.txt'],
  ])('the %s app ships the same fields', (app, canonical) => {
    const file = readFileSync(
      join(root, `apps/${app}/public/.well-known/security.txt`),
      'utf8',
    );
    expect(file).toBe(securityTxt(canonical));
  });

  it('the API serves it with a canonical URL from API_PUBLIC_URL', () => {
    expect(apiSecurityTxtCanonical('https://api.codify.app/api')).toBe(
      'https://api.codify.app/.well-known/security.txt',
    );
    expect(apiSecurityTxtCanonical(undefined)).toBeUndefined();
    expect(apiSecurityTxtCanonical('not a url')).toBeUndefined();
    expect(new SecurityTxtController().get()).toContain(
      `Contact: ${SECURITY_CONTACT}`,
    );
  });
});
