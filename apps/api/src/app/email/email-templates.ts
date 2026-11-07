import type { NotificationKind } from '@prisma/client';
import { copyLocale, emailChrome, type UnsubscribePageCopy } from './copy.js';

export interface EmailTemplateInput {
  kind: NotificationKind;
  locale: string;
  title: string;
  body: string;
  /** Extra paragraphs / stat lines (e.g. the weekly recap numbers). */
  lines?: string[];
  /** Absolute URL of the call to action. */
  ctaUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
  locked: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One accessible layout for every transactional email (WELCOME, BILLING,
 * WEEKLY_RECAP, REACTIVATION, …): `lang` set, a single-column table that
 * survives email clients, real text + a plain-text alternative, a
 * high-contrast CTA link and the footer with the reason + unsubscribe link
 * (docs/10 §3). All interpolated values are escaped.
 */
export function renderEmail(input: EmailTemplateInput): RenderedEmail {
  const lang = copyLocale(input.locale);
  const chrome = emailChrome(input.locale, input.kind, input.locked);
  const lines = input.lines ?? [];

  const text = [
    input.title,
    '',
    input.body,
    ...(lines.length ? ['', ...lines.map((l) => `• ${l}`)] : []),
    '',
    `${chrome.cta}: ${input.ctaUrl}`,
    '',
    '—',
    chrome.reason,
    `${chrome.unsubscribe}: ${input.unsubscribeUrl}`,
    `${chrome.settings}: ${input.settingsUrl}`,
  ].join('\n');

  const e = escapeHtml;
  const list = lines.length
    ? `<ul style="margin:0 0 24px;padding-left:20px;color:#1f2937;font-size:16px;line-height:1.6">${lines
        .map((l) => `<li>${e(l)}</li>`)
        .join('')}</ul>`
    : '';
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
<tr><td style="padding:32px 28px">
<p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#4338ca">${e(chrome.brand)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827">${e(input.title)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1f2937">${e(input.body)}</p>
${list}<p style="margin:0 0 8px"><a href="${e(input.ctaUrl)}" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 20px;border-radius:8px">${e(chrome.cta)}</a></p>
</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #e5e7eb">
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#4b5563">${e(chrome.reason)}</p>
<p style="margin:0;font-size:13px;line-height:1.5"><a href="${e(input.unsubscribeUrl)}" style="color:#4338ca">${e(chrome.unsubscribe)}</a> · <a href="${e(input.settingsUrl)}" style="color:#4338ca">${e(chrome.settings)}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: input.title, text, html };
}

/** The small page GET /email/unsubscribe answers with. */
export function renderUnsubscribePage(
  locale: string,
  copy: UnsubscribePageCopy,
  settingsUrl: string,
): string {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="${copyLocale(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(copy.title)}</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;color:#111827}
main{max-width:480px;margin:48px auto;padding:32px 24px;background:#fff;border-radius:12px}
h1{font-size:22px;margin:0 0 12px}
p{font-size:16px;line-height:1.6;margin:0 0 20px;color:#1f2937}
a{color:#4338ca;font-weight:600}
a:focus-visible{outline:2px solid #4338ca;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>${e(copy.title)}</h1>
<p>${e(copy.body)}</p>
<p><a href="${e(settingsUrl)}">${e(copy.link)}</a></p>
</main>
</body>
</html>`;
}
