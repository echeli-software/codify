import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { NoThrottle } from './throttling/throttle.decorators.js';

/**
 * RFC 9116 security.txt (docs/14 §19), served by the API at
 * `/.well-known/security.txt` (outside the /api prefix) and shipped as a
 * static file by the student and admin apps
 * (apps/<app>/public/.well-known/security.txt, same fields — a spec keeps
 * them in sync and fails a month before `Expires`).
 *
 * The contact is the planned security mailbox; like the legal pages it is
 * a draft to confirm before launch (bracketed note in the file).
 */
export const SECURITY_TXT_EXPIRES = '2027-10-31T23:59:59.000Z';
export const SECURITY_CONTACT = 'mailto:security@codify.app';

export function securityTxt(canonical?: string): string {
  return [
    '# Codify security policy (RFC 9116).',
    '# [Draft pending security/legal review: confirm the contact mailbox and',
    '# the Expires date before launch; renew Expires at least yearly.]',
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    'Preferred-Languages: en, pt',
    ...(canonical ? [`Canonical: ${canonical}`] : []),
    '',
  ].join('\n');
}

/** Canonical URL for the API host, from API_PUBLIC_URL (…/api) when set. */
export function apiSecurityTxtCanonical(
  apiPublicUrl: string | undefined,
): string | undefined {
  if (!apiPublicUrl) return undefined;
  try {
    return new URL('/.well-known/security.txt', apiPublicUrl).toString();
  } catch {
    return undefined;
  }
}

@Controller('.well-known')
export class SecurityTxtController {
  private readonly body = securityTxt(
    apiSecurityTxtCanonical(process.env['API_PUBLIC_URL']?.trim()),
  );

  @Public()
  @NoThrottle()
  @Get('security.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  get(): string {
    return this.body;
  }
}
